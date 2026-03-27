import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, query, where, getDocs, updateDoc, doc, setDoc, getDoc, orderBy, limit } from "firebase/firestore";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase on Server
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf-8"));
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const PORT = 3000;

  app.use(express.json());

  // Socket.io Connection
  io.on("connection", (socket) => {
    console.log("Client connected to RNFIDS Real-time Stream:", socket.id);
    
    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", system: "RNFIDS", timestamp: new Date().toISOString() });
  });

  // Push score update to all connected clients
  app.post("/api/matches/:id/score", (req, res) => {
    const { id } = req.params;
    const { home, away, eventType, scorer } = req.body;

    const update = {
      matchId: id,
      score: { home, away },
      eventType, // e.g., 'GOAL', 'VAR_OVERTURN'
      scorer,
      timestamp: new Date().toISOString()
    };

    // Broadcast to all clients
    io.emit("score-update", update);

    console.log(`[REAL-TIME PUSH] Match ${id} score updated: ${home}-${away}`);
    res.json({ success: true, update });
  });

  // Discipline Engine: Process match events for disciplinary actions
  app.post("/api/events", async (req, res) => {
    const event = req.body;
    console.log(`[DISCIPLINE ENGINE] Processing event: ${event.type} for player ${event.playerId}`);

    try {
      // 1. Save Event to Firestore
      const eventRef = await addDoc(collection(db, 'events'), {
        ...event,
        timestamp: new Date().toISOString()
      });

      // 2. Process Discipline Logic
      if (event.type === 'yellow_card' || event.type === 'red_card') {
        // Fetch player to get teamId
        const playerDoc = await getDoc(doc(db, 'players', event.playerId));
        const playerData = playerDoc.data();
        const teamId = playerData?.teamId;

        let shouldBeSuspended = false;
        let yellowInWindow = 0;
        let redCards = 0;

        if (event.type === 'red_card') {
          shouldBeSuspended = true;
          redCards = 1; // At least one red card now
        } else {
          // Yellow card logic: Check last 5 matches for this team
          const homeMatchesQuery = query(
            collection(db, 'matches'),
            where('homeTeamId', '==', teamId),
            orderBy('date', 'desc'),
            limit(5)
          );
          const awayMatchesQuery = query(
            collection(db, 'matches'),
            where('awayTeamId', '==', teamId),
            orderBy('date', 'desc'),
            limit(5)
          );

          const [homeSnap, awaySnap] = await Promise.all([
            getDocs(homeMatchesQuery),
            getDocs(awayMatchesQuery)
          ]);

          const recentMatches = [...homeSnap.docs, ...awaySnap.docs]
            .map(d => ({ id: d.id, date: d.data().date }))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 5);
          
          const recentMatchIds = recentMatches.map(m => m.id);

          // Count yellow cards for this player in these matches
          const playerYellowQuery = query(
            collection(db, 'events'),
            where('playerId', '==', event.playerId),
            where('type', '==', 'yellow_card')
          );
          const yellowSnap = await getDocs(playerYellowQuery);
          yellowInWindow = yellowSnap.docs.filter(d => recentMatchIds.includes(d.data().matchId)).length;

          if (yellowInWindow >= 3) {
            shouldBeSuspended = true;
          }
        }

        // Update Discipline Record (Summary)
        const disciplineRef = doc(db, 'discipline', event.playerId);
        const disciplineDoc = await getDoc(disciplineRef);
        
        const disciplineData = {
          playerId: event.playerId,
          yellowCards: yellowInWindow, // We'll store the windowed count for clarity
          redCards: redCards || (disciplineDoc.exists() ? disciplineDoc.data().redCards : 0),
          suspended: shouldBeSuspended,
          lastUpdated: new Date().toISOString(),
          matchWindow: 5
        };

        if (disciplineDoc.exists()) {
          await updateDoc(disciplineRef, disciplineData);
        } else {
          await setDoc(disciplineRef, disciplineData);
        }

        // 3. Update Player Status if suspended
        if (shouldBeSuspended) {
          await updateDoc(doc(db, 'players', event.playerId), {
            status: 'suspended'
          });

          const reason = event.type === 'red_card' ? 'a red card' : `accumulating ${yellowInWindow} yellow cards in the last 5 matches`;
          const message = `PLAYER SUSPENDED: ${playerData?.name || event.playerId} has been flagged for ${reason}.`;
          
          io.emit("discipline-update", {
            playerId: event.playerId,
            yellowCards: yellowInWindow,
            redCards: disciplineData.redCards,
            suspended: true,
            message
          });
          
          console.log(`[DISCIPLINE ENGINE] ${message}`);
        } else {
          io.emit("discipline-update", {
            playerId: event.playerId,
            yellowCards: yellowInWindow,
            redCards: disciplineData.redCards,
            suspended: false,
            message: `Card recorded for ${playerData?.name || event.playerId}. Total in window: ${yellowInWindow}Y.`
          });
        }
      }

      io.emit("new-event", { ...event, id: eventRef.id });
      res.json({ status: "processed", eventId: eventRef.id });
    } catch (error) {
      console.error("[DISCIPLINE ENGINE] Error processing event:", error);
      res.status(500).json({ error: "Failed to process event" });
    }
  });

  // AI Dataset Builder: Export events and decisions in COCO-like format
  app.get("/api/dataset/export", (req, res) => {
    const dataset = {
      info: {
        description: "RNFIDS National Football Intelligence Dataset",
        version: "1.0",
        year: 2026,
        contributor: "RNFIDS System",
        date_created: new Date().toISOString()
      },
      categories: [
        { id: 1, name: "goal", supercategory: "event" },
        { id: 2, name: "yellow_card", supercategory: "discipline" },
        { id: 3, name: "red_card", supercategory: "discipline" },
        { id: 4, name: "foul", supercategory: "event" }
      ],
      annotations: [
        {
          id: 101,
          image_id: "frame_001",
          category_id: 1,
          bbox: [100, 200, 50, 50],
          area: 2500,
          iscrowd: 0
        }
      ]
    };
    res.json(dataset);
  });

  // Video Clip Automation: Simulated processing
  app.post("/api/video/clip", (req, res) => {
    const { eventId, matchId } = req.body;
    
    console.log(`[VIDEO SERVICE] Generating clip for event ${eventId} in match ${matchId}...`);
    
    // Simulate processing delay
    setTimeout(() => {
      const clipUrl = `https://storage.googleapis.com/rnfids-clips/match_${matchId}/clip_${eventId}.mp4`;
      io.emit("clip-ready", { eventId, matchId, clipUrl });
      console.log(`[VIDEO SERVICE] Clip ready: ${clipUrl}`);
    }, 4000);

    res.json({ status: "processing", message: "Clip generation started" });
  });

  // Mock analytics for initial dashboard load
  app.get("/api/analytics/summary", (req, res) => {
    res.json({
      totalMatches: 12,
      totalDecisions: 45,
      accuracyRate: 0.88,
      controversyIndex: 0.12
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
