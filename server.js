const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const cors = require("cors");

// MongoDB connection
mongoose
  .connect("mongodb+srv://kraj:Champion1685@cluster0.o7g0j.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

const User = mongoose.model("User", userSchema);

// Express setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Active users and chat history
const activeUsers = new Map();
const chatHistory = new Map();

// WebRTC signaling for video calls
const groupCallParticipants = new Set();

// Socket.IO setup
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Store the user in the active users map
  activeUsers.set(socket.id, `Guest-${socket.id.slice(0, 5)}`);
  io.emit("userList", Array.from(activeUsers.values()));

  // Group chat message handling
  socket.on("chatMessage", (data) => {
    const sender = activeUsers.get(socket.id) || "Anonymous";
    io.emit("chatMessage", { sender, message: data.message });
  });

  // Private messaging
  socket.on("privateMessage", (data) => {
    const { targetUsername, message } = data;
    const sender = activeUsers.get(socket.id);
    const targetSocketId = [...activeUsers.entries()].find(
      ([, username]) => username === targetUsername
    )?.[0];

    if (targetSocketId) {
      io.to(targetSocketId).emit("privateMessage", { sender, message });
      socket.emit("privateMessage", { sender, message });
    } else {
      socket.emit("errorMessage", { error: "User not found" });
    }
  });

  // WebRTC signaling for video calls
  socket.on("callUser", ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit("callUser", { from: socket.id, offer });
  });

  socket.on("answerCall", ({ to, answer }) => {
    io.to(to).emit("callAnswered", { from: socket.id, answer });
  });

  socket.on("iceCandidate", ({ to, candidate }) => {
    io.to(to).emit("iceCandidate", { from: socket.id, candidate });
  });

  // Group call signaling
  socket.on("joinGroupCall", () => {
    groupCallParticipants.add(socket.id);
    io.emit("groupCallParticipants", Array.from(groupCallParticipants));
  });

  socket.on("leaveGroupCall", () => {
    groupCallParticipants.delete(socket.id);
    io.emit("groupCallParticipants", Array.from(groupCallParticipants));
  });

  socket.on("groupCallOffer", ({ offer }) => {
    groupCallParticipants.forEach((participantId) => {
      if (participantId !== socket.id) {
        io.to(participantId).emit("groupCallOffer", { from: socket.id, offer });
      }
    });
  });

  socket.on("groupCallAnswer", ({ to, answer }) => {
    io.to(to).emit("groupCallAnswer", { from: socket.id, answer });
  });

  socket.on("groupIceCandidate", ({ candidate }) => {
    groupCallParticipants.forEach((participantId) => {
      if (participantId !== socket.id) {
        io.to(participantId).emit("groupIceCandidate", { from: socket.id, candidate });
      }
    });
  });

  // Handle user disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    activeUsers.delete(socket.id);
    groupCallParticipants.delete(socket.id);
    io.emit("userList", Array.from(activeUsers.values()));
    io.emit("groupCallParticipants", Array.from(groupCallParticipants));
  });
});

// User Authentication Routes
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Username and password are required");

  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).send("User registered successfully");
  } catch (err) {
    res.status(400).send("Username already exists");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Username and password are required");

  const user = await User.findOne({ username });
  if (!user) return res.status(404).send("User not found");

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) return res.status(401).send("Invalid password");

  res.status(200).send("Login successful");
});

// Default route
app.get("/", (req, res) => {
  res.send("Welcome to the Chat and Video Call Server!");
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
