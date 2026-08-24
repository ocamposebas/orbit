import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

type AgreementDocument = {
  id: string;
  termsVersion: string;
  legalName: string | null | undefined;
  tradeName: string | null | undefined;
  entityType: string | null | undefined;
  taxId: string | null | undefined;
  registrationNumber: string | null | undefined;
  businessAddress: string | null | undefined;
  city: string | null | undefined;
  region: string | null | undefined;
  postalCode: string | null | undefined;
  countryCode: string | null | undefined;
  coveredDomains: string | null | undefined;
  primaryContactName: string | null | undefined;
  primaryContactRole: string | null | undefined;
  primaryContactEmail: string | null | undefined;
  primaryContactPhone: string | null | undefined;
  billingDescriptor: string | null | undefined;
  estimatedMonthlyVolume: string | null | undefined;
  averageTransactionAmount: string | null | undefined;
  highestTransactionAmount: string | null | undefined;
  productsAndServices: string | null | undefined;
  informationCertifiedAt: Date | null;
  merchant: { businessName: string; industry: string };
};

const REPRESENTATIVE = "Sebastian Ocampo";

function escapeHtml(value: unknown) {
  return String(value ?? "—").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function date(value: Date | null) {
  return value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" }).format(value) : "—";
}

function field(label: string, value: unknown) {
  return `<div class="field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function section(number: string, title: string, body: string) {
  return `<section><div class="section-head"><span>${number}</span><h2>${escapeHtml(title)}</h2></div>${body}</section>`;
}

export function agreementDocumentHtml(agreement: AgreementDocument) {
  const reference = `ORB-${agreement.id.slice(-10).toUpperCase()}`;
  const certified = date(agreement.informationCertifiedAt);
  const partyGrid = [
    field("Razón social", agreement.legalName), field("Nombre comercial", agreement.tradeName),
    field("Tipo de entidad", agreement.entityType), field("Identificación fiscal", agreement.taxId),
    field("Registro mercantil", agreement.registrationNumber), field("País", agreement.countryCode),
    field("Dirección", agreement.businessAddress), field("Ciudad / región", `${agreement.city ?? "—"}, ${agreement.region ?? "—"} ${agreement.postalCode ?? ""}`),
    field("Dominios cubiertos", agreement.coveredDomains), field("Contacto autorizado", `${agreement.primaryContactName ?? "—"} · ${agreement.primaryContactRole ?? "—"}`),
    field("Email", agreement.primaryContactEmail), field("Teléfono", agreement.primaryContactPhone),
  ].join("");
  const commercialGrid = [
    field("Descriptor de facturación", agreement.billingDescriptor), field("Volumen mensual estimado", agreement.estimatedMonthlyVolume),
    field("Transacción promedio", agreement.averageTransactionAmount), field("Transacción máxima esperada", agreement.highestTransactionAmount),
  ].join("");

  const sections = [
    section("01", "Definiciones y naturaleza B2B", `<p>Este Acuerdo de Participación, Monitoreo y Servicios (el <b>“Acuerdo”</b>) se celebra entre ORBIT (el <b>“Proveedor”</b>), representada para este acto por ${REPRESENTATIVE}, y el comercio identificado en la carátula (el <b>“Comercio”</b>). Los Servicios se ofrecen exclusivamente para fines empresariales. El Comercio declara que actúa en desarrollo de su actividad comercial y no como consumidor.</p><p><b>“Contenido del Comercio”</b> comprende sitios web, productos, políticas, afirmaciones publicitarias, flujos de compra y materiales digitales bajo su control. <b>“Monitoreo”</b> significa observación automatizada y revisión de señales públicas dentro del alcance técnicamente accesible. <b>“Hallazgo”</b> es una señal sustentada en evidencia que requiere valoración contextual; no equivale por sí sola a una conclusión legal.</p>`),
    section("02", "Alcance de los Servicios", `<p>ORBIT podrá prestar, según la orden o plan contratado: (a) evaluación inicial del sitio; (b) descubrimiento y clasificación de páginas, productos y políticas; (c) detección de cambios y conservación de evidencia; (d) análisis de señales asociadas con reglas de redes de tarjetas, procesadores y políticas aplicables; (e) reportes, puntajes internos, alertas y recomendaciones de remediación; y (f) integraciones técnicas habilitadas de forma separada.</p><p>El alcance se limita al contenido público alcanzado por los sistemas de ORBIT y a la información entregada por el Comercio. Áreas privadas, contenido bloqueado, imágenes no interpretables, estados dinámicos no reproducibles y sistemas de terceros pueden quedar fuera de observación.</p>`),
    section("03", "Servicios expresamente excluidos", `<p>ORBIT no es banco adquirente, procesador de pagos, facilitador de pagos, red de tarjetas, autoridad, certificador ni firma de abogados. Salvo pacto escrito independiente, no realiza KYC/KYB, verificación de identidad o beneficiarios finales, consultas MATCH/TMF, OFAC/PEP/AML, antecedentes, crédito, validación fiscal, auditoría PCI DSS, pruebas de penetración, representación de contracargos ni asesoría legal, tributaria o financiera.</p><p>Las decisiones de aprobación, reservas, retenciones, tarifas, suspensión o terminación pertenecen exclusivamente al procesador, adquirente u otra entidad competente.</p>`),
    section("04", "Obligaciones y declaraciones del Comercio", `<p>El Comercio se obliga a: (a) proporcionar información veraz, completa y actualizada; (b) revelar todos los dominios, subdominios, canales y activos digitales relevantes; (c) mantener políticas claras de privacidad, términos, reembolsos, envíos y contacto; (d) abstenerse de afirmaciones engañosas, ilegales o no sustentadas; (e) implementar oportunamente las correcciones que decida adoptar; (f) informar cambios materiales de productos, propiedad, modelo, precios, suscripciones, tráfico, cumplimiento, logística o procesamiento; (g) proteger sus credenciales; y (h) cumplir leyes, reglas de redes y contratos con terceros.</p><p>El Comercio responde por agencias, afiliados, influenciadores, contratistas y terceros que actúen por su cuenta. La certificación electrónica del formulario confirma la autoridad del remitente y la exactitud de la información entregada.</p>`),
    section("05", "Monitoreo, hallazgos y medidas de riesgo", `<p>ORBIT puede priorizar señales por niveles de riesgo y emitir solicitudes de remediación. El Comercio entiende que los puntajes son herramientas internas de priorización, pueden cambiar al aparecer nueva evidencia y no son certificaciones. ORBIT podrá limitar o suspender el Servicio cuando exista impago, negativa reiterada a remediar, riesgo de seguridad, contenido ilegal, fraude aparente, exposición regulatoria o incumplimiento material. Cuando sea razonable y no exista urgencia, ORBIT comunicará la situación y otorgará un plazo de subsanación.</p>`),
    section("06", "Tarifas, vigencia y terminación", `<p>Tarifas, impuestos, fecha de inicio, periodicidad y servicios seleccionados constarán en la orden de servicio, propuesta o factura aceptada. Salvo que allí se indique lo contrario, los cargos por trabajo ya iniciado no son reembolsables y las suscripciones se facturan por anticipado. Cualquiera de las partes podrá terminar conforme al preaviso de la orden; la terminación no elimina obligaciones devengadas ni las cláusulas que por su naturaleza deban sobrevivir.</p>`),
    section("07", "Sin garantía de aprobación o resultado", `<p>ORBIT no garantiza aprobación o continuidad de cuentas, ausencia de multas, contracargos o incidentes, cumplimiento absoluto, disponibilidad ininterrumpida ni detección de todo riesgo. Un resultado favorable significa únicamente que no se observó una señal material dentro de la evidencia y cobertura efectivamente revisadas. El Comercio conserva la responsabilidad exclusiva sobre sus productos, operaciones, publicaciones y cumplimiento normativo.</p>`),
    section("08", "Datos, seguridad y confidencialidad", `<p>Cada parte protegerá la información confidencial de la otra con medidas razonables y la utilizará únicamente para ejecutar este Acuerdo. ORBIT podrá procesar Contenido del Comercio, datos operativos limitados y evidencia para prestar, asegurar y mejorar los Servicios, documentar decisiones y cumplir obligaciones legítimas. ORBIT no requiere ni debe recibir números completos de tarjeta, CVV ni credenciales bancarias.</p><p>ORBIT aplicará controles administrativos, técnicos y organizativos comercialmente razonables. Ningún sistema es completamente seguro. Un incidente confirmado que afecte materialmente información de la otra parte será comunicado dentro del plazo exigido por la ley aplicable y, cuando no exista otro plazo, sin demora indebida después de su confirmación.</p>`),
    section("09", "Retención, propiedad intelectual y publicidad", `<p>El Comercio conserva la titularidad de su contenido y otorga a ORBIT una licencia limitada para observarlo, copiarlo y analizarlo con el fin de prestar los Servicios y mantener el expediente. ORBIT conserva sus programas, modelos, reglas, interfaces, metodologías, plantillas y documentación. Los registros podrán conservarse durante la relación y posteriormente por el tiempo razonablemente necesario para auditoría, seguridad, defensa de reclamaciones y obligaciones legales; después se eliminarán o anonimizarán conforme a la política aplicable.</p><p>Ninguna parte podrá usar el nombre o logotipo de la otra con fines publicitarios sin consentimiento previo, salvo identificación operativa necesaria para prestar el Servicio.</p>`),
    section("10", "Responsabilidad e indemnidad", `<p>En la máxima medida permitida por la ley, ninguna parte responderá por daños indirectos, especiales, punitivos o consecuenciales, lucro cesante, pérdida de oportunidad, reputación o datos. La responsabilidad agregada de ORBIT relacionada con este Acuerdo no excederá las tarifas efectivamente pagadas por el Comercio a ORBIT durante los doce meses anteriores al hecho que originó la reclamación. Estas limitaciones no se aplican cuando la ley lo prohíba ni a dolo, fraude o culpa grave en la medida en que no puedan limitarse.</p><p>El Comercio defenderá e indemnizará a ORBIT frente a reclamaciones de terceros derivadas de sus productos, contenido, afirmaciones, incumplimiento legal o violación del Acuerdo. ORBIT indemnizará al Comercio frente a reclamaciones de terceros causadas directamente por dolo, culpa grave, infracción de propiedad intelectual atribuible al Servicio o incumplimiento material de ORBIT.</p>`),
    section("11", "Terceros, comunicaciones y relación independiente", `<p>ORBIT podrá usar subprocesadores e integraciones técnicas sujetos a obligaciones adecuadas de seguridad y confidencialidad. Cuando sea necesario para ejecutar una integración autorizada, responder a una solicitud legítima o proteger la integridad del programa, ORBIT podrá compartir información pertinente con procesadores, adquirentes, asesores o autoridades. Nada crea sociedad, mandato, agencia, empleo, fiduciaria o exclusividad entre las partes.</p>`),
    section("12", "Disputas, avisos y disposiciones generales", `<p>Antes de iniciar una reclamación formal, las partes intentarán resolverla de buena fe durante treinta (30) días desde el aviso escrito. La ley aplicable, sede y mecanismo de resolución serán los indicados en la orden de servicio o documento corporativo del Proveedor vigente al contratar. Esta disposición no impide solicitar medidas urgentes para proteger seguridad, confidencialidad o propiedad intelectual.</p><p>Los avisos se enviarán a los correos registrados. Si una disposición resulta inexigible, se ajustará al mínimo necesario y las demás continuarán vigentes. Ninguna parte responderá por retrasos fuera de su control razonable. Este Acuerdo, la orden, el formulario certificado y las políticas incorporadas constituyen el acuerdo integral; las modificaciones requieren aceptación escrita o electrónica verificable. La cesión por el Comercio requiere consentimiento previo de ORBIT; ORBIT podrá ceder en una reorganización o venta del negocio si el cesionario asume sus obligaciones.</p>`),
  ].join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size:A4; margin:15mm 14mm 19mm; } *{box-sizing:border-box} body{margin:0;color:#17191d;font:10px/1.62 Arial,sans-serif} .cover{height:258mm;display:flex;flex-direction:column;break-after:page;background:#0a0c10;color:#f7f7f3;padding:18mm;margin:-15mm -14mm -19mm} .brand{font-size:14px;font-weight:700;letter-spacing:3px}.brand i{display:inline-block;width:9px;height:9px;border:2px solid #8b8cff;border-radius:50%;margin-right:8px}.hero{margin-top:42mm}.kicker,.section-head span{color:#8b8cff;font-size:8px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase}.hero h1{font-size:37px;line-height:1.04;letter-spacing:-1.5px;margin:5mm 0 5mm;max-width:155mm;font-weight:500}.hero p{max-width:120mm;color:#a4a8b1;font-size:12px}.cover-foot{margin-top:auto;display:grid;grid-template-columns:1.3fr 1fr 1fr;border-top:1px solid #2d3037;padding-top:6mm;gap:7mm}.cover-foot span,.field span{display:block;color:#7e838d;font-size:7px;letter-spacing:1px;text-transform:uppercase}.cover-foot b{display:block;margin-top:2mm;font-size:10px;font-weight:500}.intro{break-after:page}.intro h1{font-size:24px;line-height:1.15;margin:0 0 3mm}.lead{color:#545963;font-size:11px}.grid{display:grid;grid-template-columns:1fr 1fr;border-left:1px solid #dfe1e5;border-top:1px solid #dfe1e5;margin-top:7mm}.field{min-height:16mm;padding:3.5mm;border-right:1px solid #dfe1e5;border-bottom:1px solid #dfe1e5}.field b{display:block;margin-top:1.5mm;font-size:10px;font-weight:500;word-break:break-word}.cert{margin-top:7mm;padding:5mm;background:#f0f0ff;border-left:2px solid #777aea}.cert b{display:block;margin-bottom:1.5mm}section{break-inside:avoid;margin-bottom:8mm}.section-head{display:flex;align-items:baseline;gap:5mm;border-bottom:1px solid #dfe1e5;padding-bottom:2.5mm;margin-bottom:3.5mm}.section-head h2{font-size:16px;letter-spacing:-.35px;margin:0;font-weight:500}p{margin:0 0 3mm;color:#4f545d}p b{color:#25282d}.signatures{break-before:page}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:14mm;margin-top:15mm}.signature{border-top:1px solid #202329;padding-top:3mm;min-height:38mm}.signature span{display:block;color:#777c85;margin-top:2mm}.notice{margin-top:10mm;padding:5mm;background:#111318;color:#aeb1b8;font-size:8px}.avoid{break-inside:avoid}
  </style></head><body>
    <div class="cover"><div class="brand"><i></i>ORBIT</div><div class="hero"><div class="kicker">Expediente contractual · ${escapeHtml(agreement.termsVersion)}</div><h1>Acuerdo de Participación, Monitoreo y Servicios</h1><p>Marco B2B para inteligencia de riesgo, monitoreo de cumplimiento y evidencia operativa.</p></div><div class="cover-foot"><div><span>Comercio</span><b>${escapeHtml(agreement.legalName)}</b></div><div><span>Referencia</span><b>${reference}</b></div><div><span>Información certificada</span><b>${certified}</b></div></div></div>
    <div class="intro"><div class="kicker">Partes e información verificada</div><h1>${escapeHtml(agreement.legalName)}</h1><p class="lead">Información suministrada y certificada por el Comercio para la preparación de este Acuerdo. La firma manuscrita o electrónica incorporada al documento descargado perfecciona la aceptación.</p><div class="grid">${partyGrid}</div><h2 style="margin:8mm 0 0;font-size:15px">Perfil comercial</h2><div class="grid">${commercialGrid}</div><div class="cert"><b>Productos y servicios declarados</b>${escapeHtml(agreement.productsAndServices)}</div><div class="cert"><b>Certificación del remitente</b>El remitente declaró tener autoridad para obligar al Comercio, certificó la exactitud y completitud de estos datos y aceptó el proceso documental electrónico el ${certified}.</div></div>
    ${sections}
    <section class="signatures"><div class="section-head"><span>13</span><h2>Aceptación y firmas</h2></div><p>Al firmar, cada firmante declara que tiene autoridad suficiente para obligar a la parte que representa, que leyó el Acuerdo y que acepta sus términos. Las firmas en contrapartes y por medios electrónicos tendrán la misma validez en la medida permitida por la ley aplicable.</p><div class="signature-grid"><div class="signature"><b>POR EL COMERCIO</b><span>Nombre: ${escapeHtml(agreement.primaryContactName)}</span><span>Cargo: ${escapeHtml(agreement.primaryContactRole)}</span><span>Firma:</span><span>Fecha:</span></div><div class="signature"><b>POR ORBIT</b><span>Representante: ${REPRESENTATIVE}</span><span>Cargo: Representante autorizado</span><span>Firma:</span><span>Fecha:</span></div></div><div class="notice">Documento generado por ORBIT con referencia ${reference}. Versión de términos ${escapeHtml(agreement.termsVersion)}. El hash criptográfico del archivo emitido se conserva en el expediente para verificar su integridad. Se recomienda revisión por asesoría jurídica competente antes de uso productivo en una jurisdicción específica.</div></section>
  </body></html>`;
}

export async function renderAgreementPdf(agreement: AgreementDocument) {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const systemExecutable = process.platform === "linux" ? ["chromium", "chromium-browser"].map((command) => spawnSync("which", [command], { encoding: "utf8" }).stdout.trim()).find(Boolean) : undefined;
  const browser = await chromium.launch({ headless: true, executablePath: configuredExecutable || systemExecutable || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(agreementDocumentHtml(agreement), { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "15mm", right: "14mm", bottom: "19mm", left: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="box-sizing:border-box;width:100%;padding:0 14mm;font:8px Arial;color:#777;display:flex;justify-content:space-between"><span>ORBIT · Acuerdo confidencial</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safeContractFilename(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70) || "comercio";
}
