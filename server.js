require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ===== DATABASE =====
const db = new sqlite3.Database('./platform.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bot_token TEXT,
        bot_username TEXT,
        enabled_commands TEXT DEFAULT '["joke","fact","dice","time","calc","password","quote","coinflip","8ball","menu"]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ===== AVAILABLE COMMANDS =====
const AVAILABLE_COMMANDS = [
    { id: 'joke', name: 'Random joke' },
    { id: 'quote', name: 'Random quote' },
    { id: 'fact', name: 'Random fact' },
    { id: 'dice', name: 'Roll dice' },
    { id: 'coinflip', name: 'Coin flip' },
    { id: '8ball', name: 'Magic 8-ball' },
    { id: 'riddle', name: 'Riddle' },
    { id: 'truth', name: 'Truth question' },
    { id: 'dare', name: 'Dare challenge' },
    { id: 'roast', name: 'Roast' },
    { id: 'compliment', name: 'Compliment' },
    { id: 'vibe', name: 'Vibe check' },
    { id: 'time', name: 'Current time' },
    { id: 'date', name: 'Today date' },
    { id: 'calc', name: 'Calculator' },
    { id: 'random', name: 'Random number' },
    { id: 'password', name: 'Generate password' },
    { id: 'uuid', name: 'UUID generator' },
    { id: 'reverse', name: 'Reverse text' },
    { id: 'upper', name: 'Uppercase' },
    { id: 'lower', name: 'Lowercase' },
    { id: 'len', name: 'Length counter' },
    { id: 'sha256', name: 'SHA256 hash' },
    { id: 'md5', name: 'MD5 hash' },
    { id: 'b64encode', name: 'Base64 encode' },
    { id: 'b64decode', name: 'Base64 decode' },
    { id: 'binary', name: 'To binary' },
    { id: 'hex', name: 'To hex' },
    { id: 'morse', name: 'Text to Morse' },
    { id: 'strength', name: 'Password strength' },
    { id: 'genpass', name: 'Secure password' },
    { id: 'scamcheck', name: 'Scam analysis' },
    { id: 'linkcheck', name: 'Link safety' },
    { id: 'sectips', name: 'Security tip' },
    { id: 'phishing', name: 'Phishing tips' },
    { id: 'linuxcmd', name: 'Linux command help' },
    { id: 'age', name: 'Age calculator' },
    { id: 'countdown', name: 'Countdown' },
    { id: 'ship', name: 'Ship calculator' },
    { id: 'rate', name: 'Rate something' },
    { id: 'advice', name: 'Random advice' },
    { id: 'mood', name: 'Mood check' },
    { id: 'goal', name: 'Set daily goal' },
    { id: 'mygoal', name: 'Show goal' },
    { id: 'pick', name: 'Pick from list' },
    { id: 'roll', name: 'Dice notation' },
    { id: 'wouldyourather', name: 'Would you rather' },
    { id: 'menu', name: 'Show menu' },
    { id: 'ping', name: 'Check latency' }
];

// ===== ACTIVE BOTS =====
const activeBots = new Map(); // userId -> bot instance

// ===== DATA POOLS =====
const DATA = {
    joke: ["Why do programmers prefer dark mode? Light attracts bugs 🐛","Why did the dev go broke? He used up all his cache 💸","How many programmers to change a bulb? None, it's hardware 💡","A SQL query walks into a bar: 'Can I join you?' 🍻","Recursion: see Recursion 🔁"],
    quote: ["The best way to predict the future is to invent it. — Alan Kay","Code is like humor. When you have to explain it, it's bad. — Cory House","Simplicity is the soul of efficiency. — Austin Freeman"],
    fact: ["Octopuses have three hearts 🐙","Honey never spoils 🍯","A day on Venus is longer than a year on Venus 🪐","Bananas are berries, strawberries aren't 🍌"],
    truth: ["What's your most embarrassing moment?","Who's your secret crush?","What's the biggest lie you've told?"],
    dare: ["Send the last photo in your gallery.","Type your name with your eyes closed.","Voice note yourself singing."],
    roast: ["You're the reason they put instructions on shampoo bottles.","Your code is like your face — buggy.","You're the human equivalent of a software update at 3 AM."],
    compliment: ["You're doing great. Even on the hard days.","Your existence makes the world better.","You're smarter than you think."],
    vibe: ["🔥 Immaculate vibes. You're unstoppable today.","✨ Chill vibes. Take it easy.","⚡ Chaotic energy. Something big is coming."],
    sectips: ["*Tip:* Use a password manager.","*Tip:* Enable 2FA on every account.","*Tip:* Never reuse passwords.","*Tip:* Update your apps."],
    phishing: ["*Phishing Signs:* Urgent language, wrong domain, asking for passwords/OTP.","*Golden Rule:* Never enter passwords into a link someone sent you."],
    advice: ["Talk less. Listen more.","When stuck, walk away for 10 minutes.","Save 10% of everything you earn.","Learn to say no without explaining yourself."],
    wouldyourather: ["Fight 1 horse-sized duck OR 100 duck-sized horses?","Always be 10 min late OR 20 min early?","Unlimited money OR unlimited time?","Read minds OR be invisible?"]
};

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// ===== BUILD BOT FOR USER =====
function buildBot(user) {
    if (activeBots.has(user.id)) {
        try { activeBots.get(user.id).stop(); } catch (e) {}
        activeBots.delete(user.id);
    }

    const bot = new Telegraf(user.bot_token);
    const enabled = JSON.parse(user.enabled_commands || '[]');

    // /start
    bot.start(ctx => {
        ctx.reply(`👋 Welcome ${ctx.from.first_name}!\n\nThis bot is owned by another user. Commands available:\n${enabled.map(c => '/' + c).join(' ')}\n\nType /menu for details.`);
    });

    // Register each command
    enabled.forEach(cmd => {
        bot.command(cmd, async ctx => {
            try {
                switch (cmd) {
                    case 'joke': case 'quote': case 'fact': case 'truth': case 'dare':
                    case 'roast': case 'compliment': case 'vibe': case 'sectips':
                    case 'phishing': case 'advice': case 'wouldyourather':
                        return ctx.reply('✨ ' + rand(DATA[cmd]));
                    case 'dice': return ctx.reply(`🎲 ${Math.floor(Math.random() * 6) + 1}`);
                    case 'coinflip': return ctx.reply(Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙');
                    case '8ball': {
                        const a = ["Yes ✅","No ❌","Maybe 🤔","Definitely 💯","Doubtful 🤨"];
                        return ctx.reply('🎱 ' + rand(a));
                    }
                    case 'riddle': {
                        const r = [{ q: "What has keys but can't open locks?", a: "A piano" },{ q: "What gets wetter the more it dries?", a: "A towel" }];
                        const pick = rand(r);
                        await ctx.reply(`🧩 ${pick.q}`);
                        setTimeout(() => ctx.reply(`💡 ${pick.a}`), 15000);
                        return;
                    }
                    case 'time': return ctx.reply(`🕐 ${new Date().toLocaleString()}`);
                    case 'date': return ctx.reply(`📅 ${new Date().toDateString()}`);
                    case 'calc': {
                        const expr = ctx.message.text.replace('/calc', '').trim();
                        if (!expr) return ctx.reply('Usage: /calc 2+2');
                        if (!/^[0-9+\-*/().\s]+$/.test(expr)) return ctx.reply('❌ Only numbers');
                        try { return ctx.reply(`🧮 ${expr} = ${eval(expr)}`); } catch { return ctx.reply('❌ Invalid'); }
                    }
                    case 'random': {
                        const a = ctx.message.text.split(' ');
                        const min = parseInt(a[1]) || 1, max = parseInt(a[2]) || 100;
                        return ctx.reply(`🎲 ${Math.floor(Math.random() * (max - min + 1)) + min}`);
                    }
                    case 'password': case 'genpass': {
                        const a = ctx.message.text.split(' ');
                        const len = Math.min(parseInt(a[1]) || 16, 64);
                        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
                        let p = '';
                        for (let i = 0; i < len; i++) p += chars[Math.floor(Math.random() * chars.length)];
                        return ctx.reply(`🔐 \`${p}\``, { parse_mode: 'Markdown' });
                    }
                    case 'uuid': {
                        const u = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                            const r = Math.random() * 16 | 0;
                            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                        });
                        return ctx.reply(`🆔 \`${u}\``, { parse_mode: 'Markdown' });
                    }
                    case 'reverse': {
                        const t = ctx.message.text.replace('/reverse', '').trim();
                        return ctx.reply(t ? t.split('').reverse().join('') : 'Usage: /reverse hello');
                    }
                    case 'upper': {
                        const t = ctx.message.text.replace('/upper', '').trim();
                        return ctx.reply(t ? t.toUpperCase() : 'Usage: /upper hello');
                    }
                    case 'lower': {
                        const t = ctx.message.text.replace('/lower', '').trim();
                        return ctx.reply(t ? t.toLowerCase() : 'Usage: /lower HELLO');
                    }
                    case 'len': {
                        const t = ctx.message.text.replace('/len', '').trim();
                        return ctx.reply(`Length: ${t.length}`);
                    }
                    case 'sha256': {
                        const t = ctx.message.text.replace('/sha256', '').trim();
                        if (!t) return ctx.reply('Usage: /sha256 hello');
                        return ctx.reply(`🔐 \`${crypto.createHash('sha256').update(t).digest('hex')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'md5': {
                        const t = ctx.message.text.replace('/md5', '').trim();
                        if (!t) return ctx.reply('Usage: /md5 hello');
                        return ctx.reply(`🔐 \`${crypto.createHash('md5').update(t).digest('hex')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'b64encode': {
                        const t = ctx.message.text.replace('/b64encode', '').trim();
                        return ctx.reply(`\`${Buffer.from(t).toString('base64')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'b64decode': {
                        const t = ctx.message.text.replace('/b64decode', '').trim();
                        try { return ctx.reply(`\`${Buffer.from(t, 'base64').toString()}\``, { parse_mode: 'Markdown' }); }
                        catch { return ctx.reply('❌ Invalid'); }
                    }
                    case 'binary': {
                        const n = parseInt(ctx.message.text.replace('/binary', '').trim());
                        return isNaN(n) ? ctx.reply('Usage: /binary 42') : ctx.reply(`🔢 \`${n.toString(2)}\``, { parse_mode: 'Markdown' });
                    }
                    case 'hex': {
                        const n = parseInt(ctx.message.text.replace('/hex', '').trim());
                        return isNaN(n) ? ctx.reply('Usage: /hex 255') : ctx.reply(`🔢 \`${n.toString(16).toUpperCase()}\``, { parse_mode: 'Markdown' });
                    }
                    case 'morse': {
                        const t = ctx.message.text.replace('/morse', '').trim().toLowerCase();
                        const map = { a:'.-', b:'-...', c:'-.-.', d:'-..', e:'.', f:'..-.', g:'--.', h:'....', i:'..', j:'.---', k:'-.-', l:'.-..', m:'--', n:'-.', o:'---', p:'.--.', q:'--.-', r:'.-.', s:'...', t:'-', u:'..-', v:'...-', w:'.--', x:'-..-', y:'-.--', z:'--..', '0':'-----', '1':'.----', '2':'..---', '3':'...--', '4':'....-', '5':'.....', '6':'-....', '7':'--...', '8':'---..', '9':'----.', ' ':'/' };
                        return ctx.reply(`📡 \`${t.split('').map(c => map[c] || c).join(' ')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'strength': {
                        const p = ctx.message.text.replace('/strength', '').trim();
                        if (!p) return ctx.reply('Usage: /strength MyPass123');
                        const score = [p.length >= 8, p.length >= 12, /[a-z]/.test(p), /[A-Z]/.test(p), /[0-9]/.test(p), /[^a-zA-Z0-9]/.test(p)].filter(Boolean).length;
                        const s = score >= 5 ? 'Very Strong 🟢' : score >= 4 ? 'Strong 🟡' : score >= 3 ? 'Medium 🟠' : 'Weak 🔴';
                        return ctx.reply(`🔐 Strength: *${s}*`, { parse_mode: 'Markdown' });
                    }
                    case 'scamcheck': {
                        const t = ctx.message.text.replace('/scamcheck', '').trim().toLowerCase();
                        const flags = [];
                        if (/urgent|immediately/.test(t)) flags.push('Urgency');
                        if (/click here/.test(t)) flags.push('Click bait');
                        if (/otp|password|pin|cvv/.test(t)) flags.push('Asks for sensitive info');
                        if (/won|winner|prize/.test(t)) flags.push('Prize bait');
                        if (/http|www\./.test(t)) flags.push('Contains link');
                        return ctx.reply(`🔍 Red flags: ${flags.length ? flags.join(', ') : 'None'}`, { parse_mode: 'Markdown' });
                    }
                    case 'linkcheck': {
                        const u = ctx.message.text.replace('/linkcheck', '').trim().toLowerCase();
                        const flags = [];
                        if (/bit\.ly|tinyurl|t\.co/.test(u)) flags.push('Shortener');
                        if (/\.tk|\.ml|\.ga|\.cf/.test(u)) flags.push('Risky TLD');
                        if (/login|verify/.test(u)) flags.push('Login keyword');
                        if (!/^https:\/\//.test(u)) flags.push('Not HTTPS');
                        return ctx.reply(`🔗 ${flags.length ? '⚠️ ' + flags.join(', ') : '✅ No obvious risks'}`);
                    }
                    case 'linuxcmd': {
                        const c = ctx.message.text.replace('/linuxcmd', '').trim().toLowerCase();
                        const cmds = { 'ls': 'List files', 'cd': 'Change directory', 'pwd': 'Print working dir', 'chmod': 'Change permissions', 'grep': 'Search text', 'ssh': 'Remote connect', 'tar': 'Archive files', 'curl': 'Transfer data' };
                        return ctx.reply(cmds[c] ? `🐧 ${c}: ${cmds[c]}` : 'Try: ls, cd, pwd, chmod, grep, ssh, tar, curl');
                    }
                    case 'age': {
                        const d = new Date(ctx.message.text.replace('/age', '').trim());
                        if (isNaN(d)) return ctx.reply('Usage: /age 2000-01-15');
                        let years = new Date().getFullYear() - d.getFullYear();
                        const m = new Date().getMonth() - d.getMonth();
                        if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) years--;
                        return ctx.reply(`🎂 Age: ${years} years`);
                    }
                    case 'countdown': {
                        const d = new Date(ctx.message.text.replace('/countdown', '').trim());
                        if (isNaN(d)) return ctx.reply('Usage: /countdown 2026-12-31');
                        const days = Math.ceil((d - new Date()) / 86400000);
                        return ctx.reply(days < 0 ? `Was ${-days} days ago` : `⏳ ${days} days left`);
                    }
                    case 'ship': {
                        const n = ctx.message.text.replace('/ship', '').trim().split(/\s+and\s+|\s*\+\s*/i);
                        if (n.length < 2) return ctx.reply('Usage: /ship John and Mary');
                        const s = Math.floor(Math.random() * 100) + 1;
                        return ctx.reply(`💘 ${n[0].trim()} × ${n[1].trim()}\n${s}%`);
                    }
                    case 'rate': {
                        const thing = ctx.message.text.replace('/rate', '').trim();
                        const s = Math.floor(Math.random() * 10) + 1;
                        return ctx.reply(`⭐ ${thing}: ${s}/10`);
                    }
                    case 'mood': {
                        const m = ctx.message.text.replace('/mood', '').trim();
                        return ctx.reply(m ? `💭 Mood logged: ${m}` : 'Usage: /mood happy');
                    }
                    case 'goal': {
                        const g = ctx.message.text.replace('/goal', '').trim();
                        return g ? ctx.reply(`🎯 Goal: ${g}`) : ctx.reply('Usage: /goal finish project');
                    }
                    case 'mygoal': return ctx.reply('Use /goal to set a goal.');
                    case 'pick': {
                        const o = ctx.message.text.replace('/pick', '').trim().split(',').filter(Boolean);
                        return o.length < 2 ? ctx.reply('Usage: /pick pizza, burger') : ctx.reply(`🎯 ${rand(o).trim()}`);
                    }
                    case 'roll': {
                        const m = ctx.message.text.split(' ')[1]?.match(/^(\d+)d(\d+)$/);
                        if (!m) return ctx.reply('Usage: /roll 2d6');
                        let total = 0;
                        for (let i = 0; i < Math.min(parseInt(m[1]), 20); i++) total += Math.floor(Math.random() * parseInt(m[2])) + 1;
                        return ctx.reply(`🎲 Total: ${total}`);
                    }
                    case 'ping': {
                        const t = Date.now();
                        await ctx.reply('🏓 Pong!');
                        return ctx.reply(`⚡ ${Date.now() - t}ms`);
                    }
                    case 'menu': {
                        return ctx.reply(`🤖 *Commands available:*\n\n${enabled.map(c => '/' + c).join('\n')}`, { parse_mode: 'Markdown' });
                    }
                    default:
                        return ctx.reply('✅ Command works (not fully implemented)');
                }
            } catch (e) {
                ctx.reply('❌ Error: ' + e.message);
            }
        });
    });

    // Unknown command
    bot.on('text', ctx => {
        if (ctx.message.text.startsWith('/')) {
            ctx.reply('❌ Unknown command. Type /menu');
        }
    });

    bot.launch().then(() => {
        console.log(`✅ Bot launched for user ${user.email}`);
    }).catch(e => {
        console.error(`❌ Bot failed for ${user.email}:`, e.message);
    });

    activeBots.set(user.id, bot);
}

// ===== START ALL BOTS ON SERVER START =====
db.all(`SELECT * FROM users WHERE bot_token IS NOT NULL`, [], (err, rows) => {
    if (err) return console.error(err);
    rows.forEach(user => buildBot(user));
    console.log(`🚀 Launched ${rows.length} bots`);
});

// ===== ROUTES =====

// Landing
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Signup
app.post('/api/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Email and password (min 6 chars) required' });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (email, password) VALUES (?, ?)`, [email, hash], function(err) {
            if (err) return res.status(400).json({ error: 'Email already registered' });
            req.session.userId = this.lastID;
            res.json({ success: true });
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Invalid email or password' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });
        req.session.userId = user.id;
        res.json({ success: true });
    });
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Get current user
app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.get(`SELECT id, email, bot_username, enabled_commands FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    });
});

// Get available commands
app.get('/api/commands', (req, res) => res.json(AVAILABLE_COMMANDS));

// Save bot settings
app.post('/api/bot/settings', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { bot_token, enabled_commands } = req.body;

    if (!bot_token || !bot_token.match(/^\d+:[A-Za-z0-9_-]+$/)) {
        return res.status(400).json({ error: 'Invalid bot token format' });
    }

    // Validate token with Telegram
    axios.get(`https://api.telegram.org/bot${bot_token}/getMe`)
        .then(response => {
            if (!response.data.ok) return res.status(400).json({ error: 'Invalid bot token' });
            const username = response.data.result.username;

            db.run(`UPDATE users SET bot_token = ?, bot_username = ?, enabled_commands = ? WHERE id = ?`,
                [bot_token, username, JSON.stringify(enabled_commands), req.session.userId],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    // Rebuild bot with new settings
                    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
                        if (!err && user) buildBot(user);
                    });
                    res.json({ success: true, username });
                });
        })
        .catch(() => res.status(400).json({ error: 'Could not verify bot token' }));
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
});
