const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = '/data';
const DB_PATH = path.join(DATA_DIR, '/data/db.json');

// --- DB Helper Functions ---
const initializeDb = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }), 'utf8');
  }
};

const readDb = () => {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error);
    return { users: [] };
  }
};

const writeDb = (data) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing database:', error);
  }
};

// --- Middleware ---
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Status: ${res.statusCode || 'pending'}`);
  next();
});

const authMiddleware = (req, res, next) => {
  const email = req.headers['x-user-email'];
  if (!email) {
    console.log('Auth failed: No email header');
    return res.status(401).json({ message: 'User email header missing' });
  }
  const db = readDb();
  const user = db.users.find(u => u.email === email);
  if (!user) {
    console.log('Auth failed: User not found for email:', email);
    return res.status(404).json({ message: 'User not found. Please create your profile first.' });
  }
  req.user = user;
  next();
};

// --- Daily Reset Logic ---
const handleDailyReset = (user) => {
  const today = new Date().toISOString().split('T')[0];
  const lastUpdated = user.lastUpdatedDate || user.startDate;

  if (today > lastUpdated) {
    console.log(`Daily reset check for ${user.email}: today=${today}, lastUpdated=${lastUpdated}`);
    const incompleteTasks = user.tasks.some(task => !task.completed);
    if (incompleteTasks && user.currentDay > 0) {
      console.log(`Resetting user ${user.email} due to incomplete tasks`);
      user.currentDay = 0;
      user.totalResets += 1;
      user.lastCompletedDate = '';
    }
    user.tasks.forEach(task => task.completed = false);
  }
  user.lastUpdatedDate = today;
  return user;
};

const DEFAULT_TASKS = [
  { id: '1', title: 'Workout #1 (45 min)', completed: false, isDefault: true },
  { id: '2', title: 'Workout #2 (45 min)', completed: false, isDefault: true },
  { id: '3', title: 'Read 10 pages (non-fiction)', completed: false, isDefault: true },
  { id: '4', title: 'Drink 1 gallon of water', completed: false, isDefault: true },
  { id: '5', title: 'Follow structured diet', completed: false, isDefault: true },
  { id: '6', title: 'Take progress photo', completed: false, isDefault: true },
];

// --- Routes ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth', (req, res) => {
  const { name, email, goal } = req.body;
  console.log('Auth request for:', { name, email, goal });
  
  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required' });
  }

  const db = readDb();
  let user = db.users.find(u => u.email === email.toLowerCase());
  let isNewUser = false;

  if (user) {
    console.log('Updating existing user:', email);
    user.name = name;
    user.goal = goal || user.goal;
  } else {
    console.log('Creating new user:', email);
    isNewUser = true;
    user = {
      id: Date.now().toString(),
      name,
      email: email.toLowerCase(),
      goal: goal || 'Complete the 75 Hard Challenge',
      startDate: new Date().toISOString().split('T')[0],
      currentDay: 0,
      lastCompletedDate: '',
      lastUpdatedDate: new Date().toISOString().split('T')[0],
      totalResets: 0,
      tasks: DEFAULT_TASKS.map(t => ({...t, id: Date.now().toString() + Math.random()})),
    };
    db.users.push(user);
  }
  
  writeDb(db);
  console.log(`User ${isNewUser ? 'created' : 'updated'} successfully:`, user.email);
  res.status(isNewUser ? 201 : 200).json(user);
});

app.get('/api/user', authMiddleware, (req, res) => {
    let user = req.user;
    user = handleDailyReset(user);
    
    const db = readDb();
    const userIndex = db.users.findIndex(u => u.email === user.email);
    if (userIndex !== -1) {
      db.users[userIndex] = user;
      writeDb(db);
    }

    console.log(`User data retrieved for ${user.email}: Day ${user.currentDay}`);
    res.json(user);
});

app.put('/api/tasks/:taskId/toggle', authMiddleware, (req, res) => {
  const { taskId } = req.params;
  console.log(`Toggle task ${taskId} for user ${req.user.email}`);
  
  const db = readDb();
  const userIndex = db.users.findIndex(u => u.email === req.user.email);
  const user = db.users[userIndex];

  const task = user.tasks.find(t => t.id === taskId);
  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }
  
  task.completed = !task.completed;
  console.log(`Task ${taskId} ${task.completed ? 'completed' : 'uncompleted'}`);

  const allCompleted = user.tasks.every(t => t.completed);
  const today = new Date().toISOString().split('T')[0];

  if (allCompleted && user.lastCompletedDate !== today) {
    user.currentDay += 1;
    user.lastCompletedDate = today;
    console.log(`All tasks completed! User ${user.email} advanced to day ${user.currentDay}`);
  }
  
  user.lastUpdatedDate = today;
  db.users[userIndex] = user;
  writeDb(db);
  res.json(user);
});

app.post('/api/tasks', authMiddleware, (req, res) => {
    const { title } = req.body;
    console.log(`Add custom task "${title}" for user ${req.user.email}`);
    
    if (!title) {
        return res.status(400).json({ message: 'Task title is required' });
    }
    
    const db = readDb();
    const userIndex = db.users.findIndex(u => u.email === req.user.email);
    const user = db.users[userIndex];

    const newTask = {
        id: Date.now().toString() + Math.random(),
        title: title.trim(),
        completed: false,
        isDefault: false,
    };
    
    user.tasks.push(newTask);
    user.lastUpdatedDate = new Date().toISOString().split('T')[0];

    db.users[userIndex] = user;
    writeDb(db);
    console.log(`Custom task added successfully for ${user.email}`);
    res.status(201).json(user);
});

app.delete('/api/tasks/:taskId', authMiddleware, (req, res) => {
    const { taskId } = req.params;
    console.log(`Remove task ${taskId} for user ${req.user.email}`);
    
    const db = readDb();
    const userIndex = db.users.findIndex(u => u.email === req.user.email);
    const user = db.users[userIndex];

    const taskToRemove = user.tasks.find(t => t.id === taskId);
    if (!taskToRemove) {
        return res.status(404).json({ message: 'Task not found' });
    }
    
    if (taskToRemove.isDefault) {
        return res.status(400).json({ message: 'Cannot remove default tasks' });
    }

    user.tasks = user.tasks.filter(t => t.id !== taskId);
    user.lastUpdatedDate = new Date().toISOString().split('T')[0];

    db.users[userIndex] = user;
    writeDb(db);
    console.log(`Task removed successfully for ${user.email}`);
    res.json(user);
});

app.get('/api/leaderboard', (req, res) => {
  console.log('Leaderboard requested');
  const db = readDb();
  const sortedUsers = db.users.sort((a, b) => {
    if (a.currentDay !== b.currentDay) return b.currentDay - a.currentDay;
    if (a.totalResets !== b.totalResets) return a.totalResets - b.totalResets;
    return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
  });
  
  // Remove sensitive data for leaderboard
  const leaderboardData = sortedUsers.map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    currentDay: user.currentDay,
    totalResets: user.totalResets,
    goal: user.goal,
    startDate: user.startDate
  }));
  
  console.log(`Leaderboard returned ${leaderboardData.length} users`);
  res.json(leaderboardData);
});

// --- Error Handling ---
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ message: 'Internal server error' });
});

// --- Server Start ---
app.listen(PORT, () => {
  initializeDb();
  console.log(`🚀 75 Hard Challenge Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});