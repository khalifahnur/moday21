import http from "node:http";
const pushes = [];          // every STK push body received
const queryResult = new Map(); // checkoutId -> resultCode (number) ; missing = still processing
let n = 0;
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  if (req.url.startsWith("/oauth/v1/generate")) {
    const ok = req.headers.authorization === "Basic " + Buffer.from("key:secret").toString("base64");
    return ok ? send(res, 200, { access_token: "tok", expires_in: "3599" }) : send(res, 400, {});
  }
  if (req.headers.authorization !== "Bearer tok") return send(res, 401, {});
  if (req.url === "/mpesa/stkpushrequest/fail") return send(res, 500, {});
  if (req.url === "/mpesa/stkpush/v1/processrequest") {
    pushes.push(data);
    if (data.PhoneNumber === "254700000099") return send(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" });
    const id = `ws_CO_test_${++n}`;
    return send(res, 200, { MerchantRequestID: `m_${n}`, CheckoutRequestID: id, ResponseCode: "0", ResponseDescription: "Success. Request accepted for processing", CustomerMessage: "Success" });
  }
  if (req.url === "/mpesa/stkpushquery/v1/query") {
    const r = queryResult.get(data.CheckoutRequestID);
    if (r === undefined) return send(res, 500, { requestId: "x", errorCode: "500.001.1001", errorMessage: "The transaction is being processed" });
    return send(res, 200, { ResponseCode: "0", ResponseDescription: "ok", CheckoutRequestID: data.CheckoutRequestID, ResultCode: String(r), ResultDesc: r === 0 ? "The service request is processed successfully." : "Request cancelled by user" });
  }
  if (req.url === "/_set") { queryResult.set(data.id, data.code); return send(res, 200, {}); }
  if (req.url === "/_pushes") return send(res, 200, pushes);
  send(res, 404, {});
}).listen(4010, () => console.log("mock on 4010"));
