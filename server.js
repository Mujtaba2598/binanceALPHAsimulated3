const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'halal-simulated-bot-secret-key-2024';
const ENCRYPTION_KEY = '12345678901234567890123456789012';

const HALAL_ASSETS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'AVAXUSDT'];

const MAX_CONCURRENT_TRADES = 5;
const PROFIT_CHECK_INTERVAL = 3000;

let simulatedBalances = {};

// ========== DATA DIRECTORIES ==========
const DATA_DIR = path.join(__dirname, 'data');
const TRADES_DIR = path.join(DATA_DIR, 'trades');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });

// ========== OWNER ACCOUNT ==========
const ownerEmail = "mujtabahatif@gmail.com";
const ownerPasswordPlain = "Mujtabah@2598";
const ownerPasswordHash = bcrypt.hashSync(ownerPasswordPlain, 10);

let users = {};
if (fs.existsSync(USERS_FILE)) {
    try { users = JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e) { users = {}; }
}

users[ownerEmail] = {
    email: ownerEmail,
    password: ownerPasswordHash,
    isOwner: true,
    isApproved: true,
    isBlocked: false,
    apiKey: "",
    secretKey: "",
    accountType: "simulated",
    createdAt: new Date().toISOString()
};
fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
console.log("✅ Owner account created");

if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({}, null, 2));

// ========== HELPER FUNCTIONS ==========
function readUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e) { return {}; } }
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }
function readPending() { try { return JSON.parse(fs.readFileSync(PENDING_FILE)); } catch(e) { return {}; } }
function writePending(data) { fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); }
function readOrders() { try { return JSON.parse(fs.readFileSync(ORDERS_FILE)); } catch(e) { return {}; } }
function writeOrders(data) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2)); }

function encrypt(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}
function decrypt(text) {
    if (!text) return "";
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '🕋 Halal Simulated Bot' });
});

// ========== AUTHENTICATION ==========
app.post('/api/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    
    const users = readUsers();
    if (users[email]) return res.status(400).json({ success: false, message: 'User already exists' });
    const pending = readPending();
    if (pending[email]) return res.status(400).json({ success: false, message: 'Request already pending' });
    
    pending[email] = { email, password: bcrypt.hashSync(password, 10), requestedAt: new Date().toISOString() };
    writePending(pending);
    res.json({ success: true, message: 'Registration request sent to owner for approval.' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const users = readUsers();
    const user = users[email];
    
    if (!user) {
        const pending = readPending();
        if (pending[email]) return res.status(401).json({ success: false, message: 'Pending owner approval' });
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (!user.isApproved && !user.isOwner) return res.status(401).json({ success: false, message: 'Account not approved' });
    if (user.isBlocked) return res.status(401).json({ success: false, message: 'Account blocked' });
    
    const token = jwt.sign({ email, isOwner: user.isOwner }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, isOwner: user.isOwner });
});

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

// ========== REAL BINANCE MARKET DATA ==========
const BINANCE_API = 'https://api.binance.com';

async function getRealBinancePrice(symbol) {
    try {
        const response = await axios.get(`${BINANCE_API}/api/v3/ticker/price?symbol=${symbol}`, { timeout: 5000 });
        return parseFloat(response.data.price);
    } catch (error) {
        const defaultPrices = {
            'BTCUSDT': 50000, 'ETHUSDT': 3000, 'BNBUSDT': 400, 'SOLUSDT': 100,
            'ADAUSDT': 0.5, 'XRPUSDT': 0.6, 'DOTUSDT': 7, 'LINKUSDT': 15,
            'MATICUSDT': 0.8, 'AVAXUSDT': 35
        };
        return defaultPrices[symbol] || 100;
    }
}

function getSimulatedBalance(email) {
    if (!simulatedBalances[email]) {
        simulatedBalances[email] = 10000;
    }
    return simulatedBalances[email];
}

function updateSimulatedBalance(email, newBalance) {
    simulatedBalances[email] = newBalance;
}

// ========== SIMULATED API ==========
app.post('/api/set-simulated-keys', authenticate, async (req, res) => {
    const users = readUsers();
    users[req.user.email].apiKey = "simulated_mode";
    users[req.user.email].secretKey = "simulated_mode";
    users[req.user.email].accountType = "simulated";
    writeUsers(users);
    
    const balance = getSimulatedBalance(req.user.email);
    res.json({ success: true, message: `✅ Simulated mode activated! Balance: $${balance.toFixed(2)} USDT`, balance: balance });
});

app.post('/api/connect-simulated', authenticate, async (req, res) => {
    const balance = getSimulatedBalance(req.user.email);
    res.json({ success: true, balance: balance, message: `✅ Connected! Balance: $${balance.toFixed(2)} USDT` });
});

app.get('/api/get-keys', authenticate, (req, res) => {
    res.json({ success: true, apiKey: "simulated_mode", secretKey: "simulated_mode", accountType: "simulated" });
});

app.post('/api/get-balance', authenticate, async (req, res) => {
    const balance = getSimulatedBalance(req.user.email);
    res.json({ success: true, balance: balance });
});

// ========== SIMPLIFIED TRADING ENGINE - GUARANTEED TO WORK ==========
const activeSessions = new Map();
let assetIndex = 0;

function nextAsset() {
    const asset = HALAL_ASSETS[assetIndex];
    assetIndex = (assetIndex + 1) % HALAL_ASSETS.length;
    return asset;
}

app.post('/api/start-trading', authenticate, async (req, res) => {
    try {
        const { investmentAmount, targetAmount, timeLimitHours, profitPercent } = req.body;
        
        if (!investmentAmount || !targetAmount) return res.status(400).json({ success: false, message: 'Investment and target required' });
        if (investmentAmount < 10) return res.status(400).json({ success: false, message: 'Minimum investment $10' });
        if (targetAmount <= investmentAmount) return res.status(400).json({ success: false, message: 'Target must be greater than investment' });
        
        const balance = getSimulatedBalance(req.user.email);
        if (balance < investmentAmount) {
            return res.status(400).json({ success: false, message: `Insufficient balance. You have $${balance}, need $${investmentAmount}` });
        }
        
        const sessionId = crypto.randomBytes(8).toString('hex');
        const profitTargetPercent = profitPercent || 2;
        
        const sessionData = {
            userId: req.user.email,
            initialInvestment: investmentAmount,
            targetAmount: targetAmount,
            currentBalance: investmentAmount,
            totalProfit: 0,
            startTime: Date.now(),
            timeLimit: timeLimitHours || 1,
            activeTrades: [],
            completedTrades: [],
            profitTargetPercent: profitTargetPercent,
            status: 'ACTIVE'
        };
        
        activeSessions.set(sessionId, sessionData);
        
        // Start the trading loop
        startSimulatedTrading(sessionId);
        
        res.json({
            success: true,
            sessionId,
            message: `✅ SIMULATED TRADING STARTED!\n💰 Investment: $${investmentAmount}\n🎯 Target: $${targetAmount}\n📈 Profit Target: ${profitTargetPercent}% per trade\n⏰ Time Limit: ${timeLimitHours || 1} hours\n\n📊 Using REAL Binance market data!\n🕋 HALAL: No Riba, No Gharar, No Maysir, No Leverage`
        });
    } catch (error) {
        console.error('Start trading error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

async function startSimulatedTrading(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') return;
    
    console.log(`[TRADING LOOP] Session ${sessionId} - Balance: $${session.currentBalance}, Target: $${session.targetAmount}, Active Trades: ${session.activeTrades.length}`);
    
    // Check if target reached
    if (session.currentBalance >= session.targetAmount) {
        session.status = 'TARGET_REACHED';
        updateSimulatedBalance(session.userId, session.currentBalance);
        activeSessions.delete(sessionId);
        console.log(`🎯 TARGET REACHED! Final balance: $${session.currentBalance.toFixed(2)}`);
        return;
    }
    
    // Check time limit
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    if (elapsedHours >= session.timeLimit) {
        session.status = 'TIME_LIMIT_REACHED';
        updateSimulatedBalance(session.userId, session.currentBalance);
        activeSessions.delete(sessionId);
        console.log(`⏰ TIME LIMIT REACHED! Final balance: $${session.currentBalance.toFixed(2)}`);
        return;
    }
    
    // Process existing trades
    for (let i = 0; i < session.activeTrades.length; i++) {
        const trade = session.activeTrades[i];
        
        if (trade.status === 'BUY_ORDER_PLACED') {
            const currentPrice = await getRealBinancePrice(trade.symbol);
            if (currentPrice <= trade.buyPrice) {
                trade.status = 'BUY_FILLED';
                trade.fillPrice = trade.buyPrice;
                trade.filledQuantity = trade.quantity;
                console.log(`📊 BUY FILLED: ${trade.filledQuantity} ${trade.symbol} at $${trade.fillPrice}`);
                
                const sellPrice = trade.fillPrice * (1 + session.profitTargetPercent / 100);
                trade.sellPrice = sellPrice;
                trade.status = 'SELL_ORDER_PLACED';
                trade.sellCreatedAt = Date.now();
                console.log(`📈 SELL ORDER: Target $${sellPrice} (${session.profitTargetPercent}% profit)`);
            }
        } else if (trade.status === 'SELL_ORDER_PLACED') {
            const currentPrice = await getRealBinancePrice(trade.symbol);
            if (currentPrice >= trade.sellPrice) {
                const profit = (trade.sellPrice - trade.fillPrice) * trade.filledQuantity;
                session.currentBalance += profit;
                session.totalProfit += profit;
                trade.status = 'COMPLETED';
                trade.profit = profit;
                trade.exitPrice = trade.sellPrice;
                session.completedTrades.push(trade);
                
                console.log(`✅ SELL FILLED! Profit: $${profit.toFixed(2)}. New balance: $${session.currentBalance.toFixed(2)}`);
                
                // Save history
                const historyFile = path.join(TRADES_DIR, session.userId.replace(/[^a-z0-9]/gi, '_') + '.json');
                let history = [];
                if (fs.existsSync(historyFile)) history = JSON.parse(fs.readFileSync(historyFile));
                history.unshift({
                    symbol: trade.symbol,
                    entryPrice: trade.fillPrice,
                    exitPrice: trade.exitPrice,
                    quantity: trade.filledQuantity,
                    profit: profit,
                    profitPercent: (profit / (trade.fillPrice * trade.filledQuantity)) * 100,
                    timestamp: new Date().toISOString(),
                    isHalal: true,
                    mode: 'simulated'
                });
                fs.writeFileSync(historyFile, JSON.stringify(history.slice(0, 500), null, 2));
                
                session.activeTrades.splice(i, 1);
                i--;
                
                updateSimulatedBalance(session.userId, session.currentBalance);
            }
        }
    }
    
    // Check target again after processing
    if (session.currentBalance >= session.targetAmount) {
        session.status = 'TARGET_REACHED';
        updateSimulatedBalance(session.userId, session.currentBalance);
        activeSessions.delete(sessionId);
        return;
    }
    
    // Place new trades if we have room
    if (session.activeTrades.length < MAX_CONCURRENT_TRADES && session.currentBalance >= 10) {
        const symbol = nextAsset();
        const currentPrice = await getRealBinancePrice(symbol);
        const buyPrice = currentPrice * 0.998;
        const investmentPerTrade = Math.min(50, session.currentBalance);
        const quantity = investmentPerTrade / buyPrice;
        
        let roundedQty = Math.floor(quantity * 10000) / 10000;
        if (symbol === 'BTCUSDT') roundedQty = Math.floor(quantity * 100000) / 100000;
        
        if (roundedQty >= 0.00001) {
            session.currentBalance -= investmentPerTrade;
            
            session.activeTrades.push({
                symbol: symbol,
                quantity: roundedQty,
                buyPrice: buyPrice,
                buyOrderId: Date.now(),
                status: 'BUY_ORDER_PLACED',
                createdAt: Date.now(),
                investedAmount: investmentPerTrade
            });
            
            console.log(`📊 NEW ORDER: $${investmentPerTrade} → ${roundedQty} ${symbol} at $${buyPrice} (Target: ${session.profitTargetPercent}%) | Real price: $${currentPrice}`);
        }
    }
    
    setTimeout(() => startSimulatedTrading(sessionId), PROFIT_CHECK_INTERVAL);
}

app.post('/api/stop-trading', authenticate, (req, res) => {
    const { sessionId } = req.body;
    if (activeSessions.has(sessionId)) {
        activeSessions.delete(sessionId);
        res.json({ success: true, message: 'Trading stopped' });
    } else {
        res.json({ success: false, message: 'Session not found' });
    }
});

app.post('/api/trade-status', authenticate, (req, res) => {
    const session = activeSessions.get(req.body.sessionId);
    if (!session) return res.json({ success: true, active: false });
    
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, session.timeLimit - elapsedHours);
    const progressPercent = ((session.currentBalance - session.initialInvestment) / (session.targetAmount - session.initialInvestment)) * 100;
    const winRate = session.completedTrades.length > 0 ? 100 : 0;
    
    res.json({
        success: true,
        active: session.status === 'ACTIVE',
        initialInvestment: session.initialInvestment,
        targetAmount: session.targetAmount,
        currentBalance: session.currentBalance,
        totalProfit: session.totalProfit,
        progressPercent: Math.min(100, Math.max(0, progressPercent)).toFixed(1),
        totalTrades: session.completedTrades.length + session.activeTrades.length,
        completedTrades: session.completedTrades.length,
        activeTradesCount: session.activeTrades.length,
        winRate: winRate,
        timeRemaining: timeRemaining.toFixed(2),
        status: session.status,
        profitTargetPercent: session.profitTargetPercent
    });
});

app.get('/api/trade-history', authenticate, (req, res) => {
    const file = path.join(TRADES_DIR, req.user.email.replace(/[^a-z0-9]/gi, '_') + '.json');
    if (!fs.existsSync(file)) return res.json({ success: true, trades: [] });
    const trades = JSON.parse(fs.readFileSync(file));
    res.json({ success: true, trades: trades });
});

app.get('/api/halal-assets', authenticate, (req, res) => {
    res.json({ success: true, assets: HALAL_ASSETS });
});

// ========== ADMIN ENDPOINTS ==========
app.get('/api/admin/pending-users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const pending = readPending();
    res.json({ success: true, pending: Object.keys(pending).map(e => ({ email: e, requestedAt: pending[e].requestedAt })) });
});

app.post('/api/admin/approve-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    const users = readUsers();
    users[email] = {
        email, password: pending[email].password, isOwner: false, isApproved: true,
        isBlocked: false, apiKey: "", secretKey: "", createdAt: new Date().toISOString()
    };
    writeUsers(users);
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} approved` });
});

app.post('/api/admin/reject-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} rejected` });
});

app.post('/api/admin/toggle-block', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const users = readUsers();
    if (!users[email]) return res.status(404).json({ success: false });
    users[email].isBlocked = !users[email].isBlocked;
    writeUsers(users);
    res.json({ success: true, message: `User ${email} is now ${users[email].isBlocked ? 'BLOCKED' : 'ACTIVE'}` });
});

app.get('/api/admin/users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    res.json({ success: true, users: Object.keys(users).map(e => ({
        email: e,
        hasApiKeys: !!users[e].apiKey,
        isOwner: users[e].isOwner,
        isApproved: users[e].isApproved,
        isBlocked: users[e].isBlocked,
        accountType: users[e].accountType || 'simulated'
    })) });
});

app.get('/api/admin/user-balances', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const balances = {};
    for (const [email, u] of Object.entries(users)) {
        balances[email] = { balance: getSimulatedBalance(email), hasKeys: true, mode: 'simulated' };
    }
    res.json({ success: true, balances });
});

app.get('/api/admin/all-trades', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const allTrades = {};
    const files = fs.readdirSync(TRADES_DIR);
    for (const file of files) {
        if (file === '.gitkeep') continue;
        const userId = file.replace('.json', '');
        allTrades[userId] = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, file)));
    }
    res.json({ success: true, trades: allTrades });
});

app.post('/api/change-password', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { currentPassword, newPassword } = req.body;
    const users = readUsers();
    const owner = users[req.user.email];
    if (!bcrypt.compareSync(currentPassword, owner.password)) return res.status(401).json({ success: false, message: 'Wrong current password' });
    owner.password = bcrypt.hashSync(newPassword, 10);
    writeUsers(users);
    res.json({ success: true, message: 'Password changed! Please login again.' });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`🕋 SIMULATED HALAL BOT - RUNNING`);
    console.log(`========================================`);
    console.log(`✅ Owner: ${ownerEmail}`);
    console.log(`✅ Password: ${ownerPasswordPlain}`);
    console.log(`✅ ${HALAL_ASSETS.length} Halal Assets`);
    console.log(`✅ SIMULATED MODE - No Real Money`);
    console.log(`========================================`);
    console.log(`Server on port: ${PORT}`);
});
