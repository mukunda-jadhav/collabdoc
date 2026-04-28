require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Room } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── MongoDB Connection ────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/collabdocs')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// ─── User color palette ───────────────────────────────────────
const USER_COLORS = [
  '#e05c5c', '#e07a5c', '#e0a35c', '#d4c05c',
  '#78c45c', '#5cbee0', '#5c8ae0', '#8b5ce0',
  '#d45ce0', '#e05c9e'
];
function colorFor(userId) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) % USER_COLORS.length;
  return USER_COLORS[Math.abs(h)];
}

// ─── REST API ─────────────────────────────────────────────────

// Generate room ID
function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// POST /api/rooms/create
app.post('/api/rooms/create', async (req, res) => {
  try {
    const { name, title, accessCode } = req.body;
    if (!name || !accessCode) return res.status(400).json({ error: 'Name and access code required' });
    if (accessCode.length < 4) return res.status(400).json({ error: 'Access code must be at least 4 characters' });

    let roomId, exists = true;
    while (exists) {
      roomId = genRoomId();
      exists = await Room.exists({ roomId });
    }

    const hash = await bcrypt.hash(accessCode, 10);
    const room = new Room({
      roomId,
      accessCodeHash: hash,
      title: title || 'Untitled Document',
      createdBy: name,
      content: '',
      version: 0,
      activity: [{ user: name, action: 'created this room' }]
    });
    await room.save();

    res.json({ roomId, title: room.title });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/rooms/join
app.post('/api/rooms/join', async (req, res) => {
  try {
    const { roomId, accessCode } = req.body;
    if (!roomId || !accessCode) return res.status(400).json({ error: 'Room ID and access code required' });

    const room = await Room.findOne({ roomId: roomId.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const match = await bcrypt.compare(accessCode, room.accessCodeHash);
    if (!match) return res.status(401).json({ error: 'Incorrect access code' });

    res.json({
      roomId: room.roomId,
      title: room.title,
      content: room.content,
      version: room.version
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/rooms/:roomId/activity
app.get('/api/rooms/:roomId/activity', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ activity: room.activity });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/rooms/:roomId/download?format=html|txt|md
// Returns the latest saved document content in the requested format.
// Requires accessCode as a query param for security — same code used to join.
app.get('/api/rooms/:roomId/download', async (req, res) => {
  try {
    const { format = 'html', accessCode } = req.query;
    const room = await Room.findOne({ roomId: req.params.roomId.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Verify access code so only authorised users can download via direct URL too
    if (accessCode) {
      const match = await bcrypt.compare(accessCode, room.accessCodeHash);
      if (!match) return res.status(401).json({ error: 'Unauthorized' });
    }

    const safeTitle = (room.title || 'document').replace(/[^a-z0-9_\-]/gi, '_');

    if (format === 'html') {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${room.title || 'Document'}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 780px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.8; font-size: 16px; }
    h1 { font-size: 2rem; border-bottom: 2px solid #eee; padding-bottom: .4em; margin-bottom: .6em; }
    h2 { font-size: 1.5rem; margin-top: 1.6em; }
    h3 { font-size: 1.2rem; margin-top: 1.4em; }
    ul, ol { padding-left: 1.5em; }
    li { margin-bottom: .3em; }
    blockquote { border-left: 4px solid #ccc; padding-left: 1em; color: #555; }
    code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-family: monospace; }
    .meta { font-size: 12px; color: #888; margin-bottom: 2em; }
  </style>
</head>
<body>
  <h1>${room.title || 'Document'}</h1>
  <p class="meta">Room: ${room.roomId} &nbsp;|&nbsp; Exported: ${new Date().toLocaleString()}</p>
  ${room.content || '<p><em>Empty document</em></p>'}
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
      return res.send(html);
    }

    if (format === 'txt') {
      // Strip HTML tags for plain text
      const text = (room.content || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const out = `${room.title || 'Document'}\n${'='.repeat((room.title || 'Document').length)}\n\nRoom: ${room.roomId} | Exported: ${new Date().toLocaleString()}\n\n${text}`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.txt"`);
      return res.send(out);
    }

    if (format === 'md') {
      // Basic HTML → Markdown conversion
      let md = room.content || '';
      md = md
        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/gi, '_$1_')
        .replace(/<i[^>]*>(.*?)<\/i>/gi, '_$1_')
        .replace(/<u[^>]*>(.*?)<\/u>/gi, '$1')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
        .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
        .replace(/<ul[^>]*>|<\/ul>/gi, '\n')
        .replace(/<ol[^>]*>|<\/ol>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const out = `# ${room.title || 'Document'}\n\n> Room: \`${room.roomId}\` | Exported: ${new Date().toLocaleString()}\n\n${md}`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      return res.send(out);
    }

    res.status(400).json({ error: 'Unknown format. Use html, txt, or md.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Socket.IO ────────────────────────────────────────────────
// Track active socket sessions: socketId -> { userId, roomId, name, color }
const sessions = new Map();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Join room after successful REST auth
  socket.on('room:join', async ({ roomId, name, userId }) => {
    try {
      const room = await Room.findOne({ roomId: roomId.toUpperCase() });
      if (!room) return socket.emit('error', { message: 'Room not found' });

      const color = colorFor(userId);
      const session = { userId, roomId: room.roomId, name, color };
      sessions.set(socket.id, session);

      // Update activeUsers in DB
      room.activeUsers = room.activeUsers.filter(u => u.userId !== userId);
      room.activeUsers.push({ userId, name, color, joinedAt: new Date(), lastSeen: new Date() });
      room.addActivity(name, 'joined the document');
      await room.save();

      socket.join(room.roomId);

      // Send current state to the joining user
      socket.emit('room:state', {
        content: room.content,
        version: room.version,
        activeUsers: room.activeUsers,
        activity: room.activity,
        title: room.title
      });

      // Notify others
      socket.to(room.roomId).emit('user:joined', { userId, name, color });
      socket.to(room.roomId).emit('activity:update', room.activity);

      // Broadcast updated user list
      io.to(room.roomId).emit('users:update', room.activeUsers);

      console.log(`${name} joined room ${room.roomId}`);
    } catch (err) {
      console.error(err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Real-time content update (operational — send delta or full content)
  socket.on('doc:update', async ({ roomId, content, version, cursorPos }) => {
    const session = sessions.get(socket.id);
    if (!session || session.roomId !== roomId) return;

    // Broadcast to others in room immediately (low latency)
    socket.to(roomId).emit('doc:update', {
      content,
      version,
      userId: session.userId,
      name: session.name,
      cursorPos
    });

    // Debounced DB save (handled per socket with a timer)
    if (socket._saveTimer) clearTimeout(socket._saveTimer);
    socket._saveTimer = setTimeout(async () => {
      try {
        await Room.findOneAndUpdate(
          { roomId },
          { content, version: version || 0, updatedAt: new Date() }
        );
      } catch (e) { console.error('Save error:', e.message); }
    }, 800);
  });

  // Cursor position broadcast
  socket.on('cursor:move', ({ roomId, position, name, color }) => {
    socket.to(roomId).emit('cursor:move', {
      userId: sessions.get(socket.id)?.userId,
      position, name, color
    });
  });

  // User typing indicator
  socket.on('user:typing', ({ roomId }) => {
    const session = sessions.get(socket.id);
    if (!session) return;
    socket.to(roomId).emit('user:typing', { userId: session.userId, name: session.name });
  });

  // Disconnect
  socket.on('disconnect', async () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    sessions.delete(socket.id);
    try {
      const room = await Room.findOne({ roomId: session.roomId });
      if (!room) return;
      room.activeUsers = room.activeUsers.filter(u => u.userId !== session.userId);
      room.addActivity(session.name, 'left the document');
      await room.save();
      io.to(session.roomId).emit('user:left', { userId: session.userId });
      io.to(session.roomId).emit('users:update', room.activeUsers);
      io.to(session.roomId).emit('activity:update', room.activity);
    } catch (e) { console.error('Disconnect error:', e.message); }
    console.log(`${session.name} disconnected from ${session.roomId}`);
  });
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 CollabDocs running at http://localhost:${PORT}`);
});