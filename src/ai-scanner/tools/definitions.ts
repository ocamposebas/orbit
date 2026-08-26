type Parameters = Record<string, unknown>;

function tool(name: string, description: string, properties: Parameters, required = Object.keys(properties)) {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties, required },
  } as const;
}

const url = { type: "string", description: "Absolute first-party HTTP(S) URL." };
const selector = { type: "string", description: "CSS selector for an element visible on the current rendered page." };
const limit = { type: "integer", minimum: 1, maximum: 100 };

export const aiScannerToolDefinitions = [
  tool("open_url", "Open an allowed first-party URL in the read-only browser and retain an objective viewport capture.", { url }),
  tool("get_page_snapshot", "Return the current rendered page URL, title, visible text, links, viewport, surrounding DOM excerpt, and optional retained screenshot.", { includeScreenshot: { type: "boolean" } }),
  tool("get_visible_text", "Return objective visible text from the rendered page.", { maxChars: { type: "integer", minimum: 500, maximum: 50000 } }),
  tool("get_dom", "Return a bounded rendered DOM excerpt. Null selects the document body.", { selector: { type: ["string", "null"] }, maxChars: { type: "integer", minimum: 500, maximum: 50000 } }),
  tool("get_links", "Return rendered anchors and destinations without assigning semantic meaning.", { scope: { type: "string", enum: ["all", "internal", "external"] }, limit }),
  tool("get_metadata", "Return objective document metadata and canonical declarations.", {}),
  tool("get_structured_data", "Return retained public JSON-LD blocks from the current page.", {}),
  tool("scroll", "Scroll the rendered page by a bounded pixel distance and retain the resulting viewport.", { deltaY: { type: "integer", minimum: -5000, maximum: 5000 } }),
  tool("go_back", "Navigate back in browser history and retain the resulting viewport.", {}),
  tool("follow_internal_link", "Open an allowed first-party link selected by Luna and retain the rendered viewport.", { url }),
  tool("inspect_navigation", "Return the rendered navigation composition, links, text, DOM context, and screenshot.", {}),
  tool("inspect_footer", "Return the rendered footer composition, links, text, DOM context, and screenshot.", {}),
  tool("inspect_category", "Open a Luna-selected category/collection URL and return objective rendered composition evidence.", { url, label: { type: ["string", "null"] } }),
  tool("enumerate_products", "Return product candidates and objective commerce signals from rendered links and structured data; no candidate is semantically classified by the tool.", { limit }),
  tool("inspect_product", "Open a Luna-selected likely product and retain its exact canonical URL/slug, complete rendered description context, price, SKU, variant, add-to-cart, structured-data, DOM, and visual evidence.", { url }),
  tool("inspect_variants", "Return objective options, selectors, and structured variant data on the current rendered page.", {}),
  tool("capture_full_page", "Retain actual full-page rendered pixels for Luna visual review.", {}),
  tool("capture_viewport", "Retain actual pixels in the current browser viewport.", {}),
  tool("capture_element", "Retain actual rendered pixels and DOM/text context for a selected element.", { selector }),
  tool("inspect_visual_region", "Retain a commercial visual composition together: pixels, text, DOM, URL, destination, CTA-like anchor/button labels, associations, position, and prominence measurements.", { selector }),
  tool("inspect_page_images", "Retain actual rendered image pixels plus surrounding composition context for visible page images.", { limit }),
  tool("inspect_background_images", "Retain actual pixels and context for rendered elements with CSS background images.", { limit }),
  tool("inspect_carousel", "Return mechanically detected scrollable/carousel-like rendered regions with pixels, child text, links, and position; the tool makes no risk decision.", { limit }),
  tool("inspect_pdf", "Open and inspect a first-party PDF/document, retaining extracted text and rendered pixels when available.", { url }),
  tool("inspect_public_api", "Issue a safe read-only GET to a Luna-selected public first-party API and retain its raw response.", { url }),
  tool("inspect_checkout_read_only", "Open a Luna-selected first-party public cart/checkout URL in a fresh read-only state and retain visible text, labeled controls, required/checked state, and rendered pixels so Luna can verify controls such as age confirmation; never submit, pay, or accept terms.", { url }),
] as const;

export const aiScannerToolNames: ReadonlySet<string> = new Set(aiScannerToolDefinitions.map((item) => item.name));
