"use client";

import { createContext, useContext } from "react";

const RoleContext = createContext("VIEWER");
export function SentinelRoleProvider({ role, children }: { role: string; children: React.ReactNode }) { return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>; }
export function useSentinelRole() { return useContext(RoleContext); }
