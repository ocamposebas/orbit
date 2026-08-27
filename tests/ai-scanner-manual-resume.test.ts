import { beforeEach, describe, expect, it, vi } from "vitest";

const { database, enqueueAiScan } = vi.hoisted(() => ({
  database: {
    aiScan: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    merchant: { update: vi.fn(async () => undefined) },
    auditLog: { create: vi.fn(async () => undefined) },
  },
  enqueueAiScan: vi.fn(async () => undefined),
}));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => database }));
vi.mock("@/ai-scanner/queue", () => ({ enqueueAiScan }));

import { resumeAiScan } from "@/ai-scanner/service";

const retainedCheckpoint = { version: 1, luna: { conversation: [] }, browser: { currentUrl: "https://merchant.example/" } };

describe("AI Scanner manual resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.aiScan.findFirst.mockResolvedValue({
      id: "scan-1",
      merchantId: "merchant-1",
      status: "AI_SCAN_INCOMPLETE",
      resumeCheckpoint: retainedCheckpoint,
      resumeCount: 12,
    });
    database.aiScan.updateMany.mockResolvedValue({ count: 1 });
  });

  it("requeues the same scan with a unique job while retaining its checkpoint", async () => {
    const result = await resumeAiScan("scan-1", "org-1", "user-1");

    expect(result).toEqual({ id: "scan-1", status: "QUEUED", resumeCount: 0, resumeAfter: null });
    expect(database.aiScan.updateMany).toHaveBeenCalledWith({
      where: { id: "scan-1", status: "AI_SCAN_INCOMPLETE" },
      data: { status: "QUEUED", failureCode: null, error: null, completedAt: null, resumeAfter: null, resumeCount: 0 },
    });
    expect(enqueueAiScan).toHaveBeenCalledWith("scan-1", expect.objectContaining({ resumeCount: 0, jobKey: expect.stringMatching(/^manual-/) }));
    expect(database.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: "user-1", action: "ai_scanner.manual_resume", metadata: { previousResumeCount: 12, checkpointRetained: true } }),
    }));
  });

  it("refuses to restart an incomplete scan that has no retained checkpoint", async () => {
    database.aiScan.findFirst.mockResolvedValue({ id: "scan-1", merchantId: "merchant-1", status: "AI_SCAN_INCOMPLETE", resumeCheckpoint: {}, resumeCount: 0 });

    await expect(resumeAiScan("scan-1", "org-1", "user-1")).rejects.toMatchObject({ status: 409 });
    expect(database.aiScan.updateMany).not.toHaveBeenCalled();
    expect(enqueueAiScan).not.toHaveBeenCalled();
  });

  it("restores the incomplete state if the queue is unavailable", async () => {
    enqueueAiScan.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(resumeAiScan("scan-1", "org-1", "user-1")).rejects.toMatchObject({ status: 503 });
    expect(database.aiScan.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "scan-1", status: "QUEUED" },
      data: expect.objectContaining({ status: "AI_SCAN_INCOMPLETE", resumeCount: 12 }),
    }));
  });
});
