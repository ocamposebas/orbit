import { createServer } from "node:http";

const port = Number(process.env.FIXTURE_PORT ?? 4177);
createServer((request, response) => { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(`<!doctype html><html><head><title>ORBIT crawler fixture</title></head><body><main><h1>${request.url === "/claim" ? "Supports rapid weight loss." : "Research catalog"}</h1><a href="/claim">Claim fixture</a></main></body></html>`); }).listen(port, "127.0.0.1", () => console.log(`Fixture ready at http://127.0.0.1:${port}`));
