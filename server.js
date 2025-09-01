import { createServer } from "http";
import next from "next";
import SockJS from "sockjs";

const dev = false;
const app = next({ dev });
const handle = app.getRequestHandler();

const PORT = process.env.PORT || 8080;

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));

  // WebSocket setup
  const sockjsServer = SockJS.createServer();
  sockjsServer.on("connection", (conn) => {
    console.log("WS connected");
    conn.on("data", (msg) => {
      console.log("WS message:", msg);
      conn.write(`Server received: ${msg}`);
    });
    conn.on("close", () => console.log("WS disconnected"));
  });
  sockjsServer.installHandlers(server, { prefix: "/ws" });

  server.listen(PORT, () => {
    console.log(`Next.js app running on port ${PORT}`);
    console.log(`WS endpoint at /ws`);
  });
});
