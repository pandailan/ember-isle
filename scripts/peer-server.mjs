// Local PeerJS signaling server for co-op development and testing.
// Run `node scripts/peer-server.mjs`, then open the game with
// ?peerhost=127.0.0.1&peerport=9900 on both devices/tabs.
import { PeerServer } from "peer";

const port = Number(process.env.PEER_PORT || 9900);
PeerServer({ port, host: "127.0.0.1", path: "/" }, () =>
  console.log(`peer server listening on 127.0.0.1:${port}`),
);
