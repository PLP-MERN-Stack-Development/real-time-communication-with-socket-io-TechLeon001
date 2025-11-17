const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173n",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});
const upload = multer({ storage: storage });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// In-memory storage (replace with database in production)
const users = new Map();
const messages = new Map();
const rooms = ['general', 'random', 'tech', 'gaming'];
const typingUsers = new Map();

// JWT secret
const JWT_SECRET = 'your-secret-key-change-in-production';

// Initialize rooms
rooms.forEach(room => {
  messages.set(room, []);
});

// Authentication middleware
const authenticateToken = (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
};

io.use(authenticateToken);

io.on('connection', (socket) => {
  console.log('User connected:', socket.username, socket.userId);

  // Add user to active users
  users.set(socket.userId, {
    id: socket.userId,
    username: socket.username,
    socketId: socket.id,
    status: 'online',
    currentRoom: 'general',
    lastSeen: new Date()
  });

  // Join general room by default
  socket.join('general');
  socket.currentRoom = 'general';

  // Send welcome message
  const welcomeMessage = {
    id: Date.now().toString(),
    username: 'System',
    userId: 'system',
    text: `Welcome to the chat, ${socket.username}!`,
    room: 'general',
    timestamp: new Date().toISOString(),
    type: 'system'
  };
  
  messages.get('general').push(welcomeMessage);
  socket.emit('receive_message', welcomeMessage);

  // Send initial data to the connected user
  socket.emit('initial_data', {
    rooms: rooms,
    users: Array.from(users.values()),
    messages: messages.get('general') || [],
    currentUser: { id: socket.userId, username: socket.username }
  });

  // Notify other users about new connection
  socket.broadcast.emit('user_joined', {
    username: socket.username,
    users: Array.from(users.values())
  });

  socket.broadcast.to('general').emit('receive_message', {
    id: Date.now().toString(),
    username: 'System',
    userId: 'system',
    text: `${socket.username} joined the chat`,
    room: 'general',
    timestamp: new Date().toISOString(),
    type: 'system'
  });

  // Handle room joining
  socket.on('join_room', (roomName) => {
    if (!rooms.includes(roomName)) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }

    // Leave current room
    socket.leave(socket.currentRoom);
    
    // Join new room
    socket.join(roomName);
    socket.currentRoom = roomName;
    
    // Update user's current room
    const user = users.get(socket.userId);
    if (user) {
      user.currentRoom = roomName;
      users.set(socket.userId, user);
    }

    // Send room messages to user
    const roomMessages = messages.get(roomName) || [];
    socket.emit('room_messages', {
      room: roomName,
      messages: roomMessages
    });
    
    // Notify room about user joining
    socket.broadcast.to(roomName).emit('user_joined_room', {
      username: socket.username,
      room: roomName
    });

    socket.broadcast.to(roomName).emit('receive_message', {
      id: Date.now().toString(),
      username: 'System',
      userId: 'system',
      text: `${socket.username} joined the room`,
      room: roomName,
      timestamp: new Date().toISOString(),
      type: 'system'
    });
  });

  // Handle message sending
  socket.on('send_message', (data) => {
    const message = {
      id: Date.now().toString(),
      username: socket.username,
      userId: socket.userId,
      text: data.text,
      room: data.room || socket.currentRoom,
      timestamp: new Date().toISOString(),
      type: data.type || 'text',
      reactions: {}
    };

    // Store message
    if (!messages.has(message.room)) {
      messages.set(message.room, []);
    }
    messages.get(message.room).push(message);

    // Send to room
    io.to(message.room).emit('receive_message', message);

    // Send notifications to users not in the room
    users.forEach((user) => {
      if (user.currentRoom !== message.room && user.socketId !== socket.id) {
        io.to(user.socketId).emit('notification', {
          type: 'new_message',
          username: socket.username,
          room: message.room,
          message: data.text.substring(0, 50) + (data.text.length > 50 ? '...' : ''),
          timestamp: new Date().toISOString()
        });
      }
    });
  });

  // Handle typing indicators
  socket.on('typing_start', (room) => {
    typingUsers.set(socket.id, { username: socket.username, room: room });
    socket.broadcast.to(room).emit('user_typing', {
      username: socket.username,
      room: room
    });
  });

  socket.on('typing_stop', (room) => {
    typingUsers.delete(socket.id);
    socket.broadcast.to(room).emit('user_stop_typing', {
      username: socket.username,
      room: room
    });
  });

  // Handle message reactions
  socket.on('react_to_message', (data) => {
    const roomMessages = messages.get(data.room);
    if (roomMessages) {
      const message = roomMessages.find(m => m.id === data.messageId);
      if (message) {
        if (!message.reactions) message.reactions = {};
        if (!message.reactions[data.reaction]) {
          message.reactions[data.reaction] = [];
        }
        
        // Remove user from other reactions to this message
        Object.keys(message.reactions).forEach(reaction => {
          message.reactions[reaction] = message.reactions[reaction].filter(
            user => user !== socket.username
          );
          if (message.reactions[reaction].length === 0) {
            delete message.reactions[reaction];
          }
        });
        
        // Add user to new reaction
        message.reactions[data.reaction].push(socket.username);
        
        io.to(data.room).emit('message_reacted', {
          messageId: data.messageId,
          reactions: message.reactions
        });
      }
    }
  });

  // Handle private messages
  socket.on('send_private_message', (data) => {
    const targetUser = Array.from(users.values()).find(u => u.username === data.targetUsername);
    if (targetUser) {
      const privateMessage = {
        id: Date.now().toString(),
        from: socket.username,
        fromId: socket.userId,
        to: data.targetUsername,
        toId: targetUser.id,
        text: data.text,
        timestamp: new Date().toISOString(),
        read: false,
        type: 'private'
      };

      // Send to target user
      io.to(targetUser.socketId).emit('receive_private_message', privateMessage);
      
      // Send back to sender
      socket.emit('receive_private_message', { 
        ...privateMessage, 
        isOwn: true 
      });
    } else {
      socket.emit('error', { message: 'User not found or offline' });
    }
  });

  // Handle file upload
  socket.on('upload_file', (data) => {
    // In a real app, you'd handle file upload here
    const fileMessage = {
      id: Date.now().toString(),
      username: socket.username,
      userId: socket.userId,
      text: `Uploaded file: ${data.filename}`,
      room: data.room || socket.currentRoom,
      timestamp: new Date().toISOString(),
      type: 'file',
      fileUrl: data.fileUrl,
      filename: data.filename
    };

    if (!messages.has(fileMessage.room)) {
      messages.set(fileMessage.room, []);
    }
    messages.get(fileMessage.room).push(fileMessage);

    io.to(fileMessage.room).emit('receive_message', fileMessage);
  });

  // Handle read receipts for private messages
  socket.on('mark_message_read', (data) => {
    // Implementation for read receipts
    socket.broadcast.emit('message_read', {
      messageId: data.messageId,
      reader: socket.username
    });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.username, 'Reason:', reason);
    
    const user = users.get(socket.userId);
    if (user) {
      users.delete(socket.userId);
      
      // Notify others
      io.emit('user_left', {
        username: socket.username,
        users: Array.from(users.values())
      });

      // Notify user's current room
      if (user.currentRoom) {
        io.to(user.currentRoom).emit('receive_message', {
          id: Date.now().toString(),
          username: 'System',
          userId: 'system',
          text: `${socket.username} left the chat`,
          room: user.currentRoom,
          timestamp: new Date().toISOString(),
          type: 'system'
        });
      }
    }

    // Remove from typing users
    typingUsers.delete(socket.id);
  });

  // Handle reconnection
  socket.on('reconnect', (attemptNumber) => {
    console.log('User reconnected:', socket.username, 'Attempt:', attemptNumber);
    
    const user = users.get(socket.userId);
    if (user) {
      user.socketId = socket.id;
      user.status = 'online';
      users.set(socket.userId, user);
      
      socket.emit('reconnect_success', {
        users: Array.from(users.values()),
        rooms: rooms,
        currentRoom: user.currentRoom,
        messages: messages.get(user.currentRoom) || []
      });
    }
  });
});

// Authentication routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if user exists
    const userExists = Array.from(users.values()).some(u => u.username === username);
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = Date.now().toString();
    
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      token, 
      user: { 
        id: userId, 
        username: username 
      } 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // In production, verify against database
    // For demo, we'll accept any user with password 'password'
    const validPassword = await bcrypt.compare(password, await bcrypt.hash('password', 10));
    
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const userId = Date.now().toString();
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      token, 
      user: { 
        id: userId, 
        username: username 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File upload route
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Get room messages
app.get('/api/rooms/:room/messages', (req, res) => {
  const room = req.params.room;
  const roomMessages = messages.get(room) || [];
  res.json(roomMessages);
});

// Get online users
app.get('/api/users/online', (req, res) => {
  res.json(Array.from(users.values()));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Client should connect to: http://localhost:${PORT}`);
  console.log(`🔐 JWT Secret: ${JWT_SECRET}`);
});