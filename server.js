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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@xitexe.com';

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
        welcome_message TEXT DEFAULT NULL,
        custom_commands TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS command_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add new columns if missing (migration)
    db.run(`ALTER TABLE users ADD COLUMN welcome_message TEXT DEFAULT NULL`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN custom_commands TEXT DEFAULT '{}'`, () => {});
});

// ===== AVAILABLE COMMANDS =====
const AVAILABLE_COMMANDS = [
    { id: 'joke', name: 'Random joke' }, { id: 'quote', name: 'Random quote' },
    { id: 'fact', name: 'Random fact' }, { id: 'dice', name: 'Roll dice' },
    { id: 'coinflip', name: 'Coin flip' }, { id: '8ball', name: 'Magic 8-ball' },
    { id: 'riddle', name: 'Riddle' }, { id: 'truth', name: 'Truth question' },
    { id: 'dare', name: 'Dare challenge' }, { id: 'roast', name: 'Roast' },
    { id: 'compliment', name: 'Compliment' }, { id: 'vibe', name: 'Vibe check' },
    { id: 'lucky', name: 'Lucky number' }, { id: 'yesno', name: 'Yes/No' },
    { id: 'pick', name: 'Pick from list' }, { id: 'roll', name: 'Dice notation' },
    { id: 'wouldyourather', name: 'Would you rather' },
    { id: 'time', name: 'Current time' }, { id: 'date', name: 'Today date' },
    { id: 'week', name: 'Day of week' }, { id: 'month', name: 'Current month' },
    { id: 'calc', name: 'Calculator' }, { id: 'random', name: 'Random number' },
    { id: 'password', name: 'Generate password' }, { id: 'genpass', name: 'Secure password' },
    { id: 'uuid', name: 'UUID generator' }, { id: 'reverse', name: 'Reverse text' },
    { id: 'upper', name: 'Uppercase' }, { id: 'lower', name: 'Lowercase' },
    { id: 'len', name: 'Length counter' }, { id: 'count', name: 'Text stats' },
    { id: 'spell', name: 'Spell letters' }, { id: 'alternate', name: 'Alternate case' },
    { id: 'titlecase', name: 'Title Case' }, { id: 'slugify', name: 'Slugify text' },
    { id: 'shuffle', name: 'Shuffle letters' }, { id: 'rotate', name: 'Rotate text' },
    { id: 'caesar', name: 'Caesar cipher' }, { id: 'vowels', name: 'Vowel count' },
    { id: 'morse', name: 'Text to Morse' }, { id: 'sha256', name: 'SHA256 hash' },
    { id: 'md5', name: 'MD5 hash' }, { id: 'b64encode', name: 'Base64 encode' },
    { id: 'b64decode', name: 'Base64 decode' }, { id: 'binary', name: 'To binary' },
    { id: 'hex', name: 'To hex' }, { id: 'octal', name: 'To octal' },
    { id: 'primes', name: 'Prime numbers' }, { id: 'fibonacci', name: 'Fibonacci' },
    { id: 'factorial', name: 'Factorial' }, { id: 'gcd', name: 'GCD' },
    { id: 'bmi', name: 'BMI calculator' }, { id: 'tip', name: 'Tip calculator' },
    { id: 'split', name: 'Split bill' }, { id: 'percent', name: 'Percentage' },
    { id: 'strength', name: 'Password strength' }, { id: 'scamcheck', name: 'Scam analysis' },
    { id: 'linkcheck', name: 'Link safety' }, { id: 'sectips', name: 'Security tip' },
    { id: 'phishing', name: 'Phishing tips' }, { id: 'randpin', name: 'Random PIN' },
    { id: 'otp', name: 'OTP safety' }, { id: 'linuxcmd', name: 'Linux command help' },
    { id: 'age', name: 'Age calculator' }, { id: 'daysuntil', name: 'Days until date' },
    { id: 'countdown', name: 'Countdown' }, { id: 'unixtime', name: 'Unix timestamp' },
    { id: 'hexcolor', name: 'Hex color info' }, { id: 'rgb', name: 'RGB to hex' },
    { id: 'ship', name: 'Ship calculator' }, { id: 'rate', name: 'Rate something' },
    { id: 'advice', name: 'Random advice' }, { id: 'mood', name: 'Mood check' },
    { id: 'goal', name: 'Set daily goal' }, { id: 'mygoal', name: 'Show goal' },
    { id: 'menu', name: 'Show menu' }, { id: 'ping', name: 'Check latency' }
];

const activeBots = new Map();

const DATA = {
    joke: ["Why do programmers prefer dark mode? Light attracts bugs 🐛","Why did the dev go broke? He used up all his cache 💸","How many programmers to change a bulb? None, it's hardware 💡"],
    quote: ["The best way to predict the future is to invent it. — Alan Kay","Code is like humor. When you have to explain it, it's bad. — Cory House"],
    fact: ["Octopuses have three hearts 🐙","Honey never spoils 🍯","A day on Venus is longer than a year on Venus 🪐"],
    truth: ["What's your most embarrassing moment?","Who's your secret crush?","What's the biggest lie you've told?"],
    dare: ["Send the last photo in your gallery.","Type your name with your eyes closed.","Voice note yourself singing."],
    roast: ["You're the reason they put instructions on shampoo bottles.","Your code is like your face — buggy."],
    compliment: ["You're doing great.","Your existence makes the world better.","You're smarter than you think."],
    vibe: ["🔥 Immaculate vibes.","✨ Chill vibes.","⚡ Chaotic energy."],
    sectips: ["*Tip:* Use a password manager.","*Tip:* Enable 2FA.","*Tip:* Never reuse passwords."],
    phishing: ["*Signs:* Urgent language, wrong domain, asking for passwords.","*Rule:* Never enter passwords into a link sent to you."],
    advice: ["Talk less. Listen more.","Save 10% of everything you earn."],
    wouldyourather: ["Fight 1 horse-sized duck OR 100 duck-sized horses?","Always be 10 min late OR 20 min early?"]
};

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// ===== BUILD BOT =====
function buildBot(user) {
    if (activeBots.has(user.id)) {
        try { activeBots.get(user.id).stop(); } catch (e) {}
        activeBots.delete(user.id);
    }

    const bot = new Telegraf(user.bot_token);
    const enabled = JSON.parse(user.enabled_commands || '[]');
    const customCmds = JSON.parse(user.custom_commands || '{}');

    bot.start(ctx => {
        const welcome = user.welcome_message || `👋 Welcome ${ctx.from.first_name}!\n\nCommands: ${enabled.map(c => '/' + c).join(' ')}\n\nType /menu for details.`;
        ctx.reply(welcome);
    });

    // Track usage helper
    const track = (cmd) => {
        db.run(`INSERT INTO command_usage (user_id, command) VALUES (?, ?)`, [user.id, cmd]);
    };

    // Register enabled commands
    enabled.forEach(cmd => {
        bot.command(cmd, async ctx => {
            track(cmd);
            const arg = ctx.message.text.replace('/' + cmd, '').trim();
            try {
                switch (cmd) {
                    case 'joke': case 'quote': case 'fact': case 'truth': case 'dare':
                    case 'roast': case 'compliment': case 'vibe': case 'sectips':
                    case 'phishing': case 'advice': case 'wouldyourather':
                        return ctx.reply('✨ ' + rand(DATA[cmd]));
                    case 'dice': return ctx.reply(`🎲 ${Math.floor(Math.random() * 6) + 1}`);
                    case 'coinflip': return ctx.reply(Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙');
                    case '8ball': return ctx.reply('🎱 ' + rand(["Yes ✅","No ❌","Maybe 🤔","Definitely 💯","Doubtful 🤨"]));
                    case 'lucky': {
                        const n = Math.floor(Math.random() * 100) + 1;
                        return ctx.reply(`🍀 ${n} — ${n >= 80 ? '🔥 Very lucky!' : n >= 50 ? '😊 Decent' : '😐 Low luck'}`);
                    }
                    case 'yesno': return ctx.reply(rand(['YES ✅','NO ❌','MAYBE 🤔','ASK AGAIN 🔄']));
                    case 'riddle': {
                        const r = rand([{ q: "What has keys but can't open locks?", a: "A piano" },{ q: "What gets wetter the more it dries?", a: "A towel" }]);
                        await ctx.reply(`🧩 ${r.q}`);
                        setTimeout(() => ctx.reply(`💡 ${r.a}`), 15000);
                        return;
                    }
                    case 'time': return ctx.reply(`🕐 ${new Date().toLocaleString()}`);
                    case 'date': return ctx.reply(`📅 ${new Date().toDateString()}`);
                    case 'week': return ctx.reply(`📅 ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]}`);
                    case 'month': return ctx.reply(`📅 ${['January','February','March','April','May','June','July','August','September','October','November','December'][new Date().getMonth()]}`);
                    case 'calc': {
                        if (!arg) return ctx.reply('Usage: /calc 2+2');
                        if (!/^[0-9+\-*/().\s]+$/.test(arg)) return ctx.reply('❌ Only numbers allowed');
                        try { return ctx.reply(`🧮 ${arg} = ${eval(arg)}`); } catch { return ctx.reply('❌ Invalid'); }
                    }
                    case 'random': {
                        const a = arg.split(' ');
                        const min = parseInt(a[0]) || 1, max = parseInt(a[1]) || 100;
                        return ctx.reply(`🎲 ${Math.floor(Math.random() * (max - min + 1)) + min}`);
                    }
                    case 'password': case 'genpass': {
                        const len = Math.min(parseInt(arg) || 16, 64);
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
                    case 'reverse': return ctx.reply(arg ? arg.split('').reverse().join('') : 'Usage: /reverse hello');
                    case 'upper': return ctx.reply(arg ? arg.toUpperCase() : 'Usage: /upper hello');
                    case 'lower': return ctx.reply(arg ? arg.toLowerCase() : 'Usage: /lower HELLO');
                    case 'len': return ctx.reply(`Length: ${arg.length}`);
                    case 'count': return ctx.reply(`📊 Chars: ${arg.length} | Words: ${arg.split(/\s+/).filter(Boolean).length}`);
                    case 'spell': return ctx.reply(arg ? arg.split('').join(' - ') : 'Usage: /spell hello');
                    case 'alternate': return ctx.reply(arg ? arg.split('').map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join('') : 'Usage: /alternate hello');
                    case 'titlecase': return ctx.reply(arg ? arg.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : 'Usage: /titlecase hello');
                    case 'slugify': return ctx.reply(arg ? `\`${arg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}\`` : 'Usage: /slugify Hello World', { parse_mode: 'Markdown' });
                    case 'shuffle': {
                        if (!arg) return ctx.reply('Usage: /shuffle hello');
                        const arr = arg.split('');
                        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
                        return ctx.reply(`🔀 ${arr.join('')}`);
                    }
                    case 'rotate': return ctx.reply(arg ? `🔄 ${arg.slice(1)}${arg[0]}` : 'Usage: /rotate hello');
                    case 'caesar': {
                        const parts = arg.split(' ');
                        const shift = parseInt(parts[0]) || 3;
                        const t = parts.slice(1).join(' ');
                        if (!t) return ctx.reply('Usage: /caesar 3 hello');
                        return ctx.reply(`🔐 ${t.replace(/[a-z]/gi, c => {
                            const base = c <= 'Z' ? 65 : 97;
                            return String.fromCharCode((c.charCodeAt(0) - base + shift + 26) % 26 + base);
                        })}`);
                    }
                    case 'vowels': {
                        const t = arg.toLowerCase();
                        const v = (t.match(/[aeiou]/g) || []).length;
                        return ctx.reply(`🔤 Vowels: ${v} | Consonants: ${t.replace(/[^a-z]/g, '').length - v}`);
                    }
                    case 'morse': {
                        const t = arg.toLowerCase();
                        const map = { a:'.-', b:'-...', c:'-.-.', d:'-..', e:'.', f:'..-.', g:'--.', h:'....', i:'..', j:'.---', k:'-.-', l:'.-..', m:'--', n:'-.', o:'---', p:'.--.', q:'--.-', r:'.-.', s:'...', t:'-', u:'..-', v:'...-', w:'.--', x:'-..-', y:'-.--', z:'--..', ' ':'/' };
                        return ctx.reply(`📡 \`${t.split('').map(c => map[c] || c).join(' ')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'sha256': return ctx.reply(arg ? `🔐 \`${crypto.createHash('sha256').update(arg).digest('hex')}\`` : 'Usage: /sha256 hello', { parse_mode: 'Markdown' });
                    case 'md5': return ctx.reply(arg ? `🔐 \`${crypto.createHash('md5').update(arg).digest('hex')}\`` : 'Usage: /md5 hello', { parse_mode: 'Markdown' });
                    case 'b64encode': return ctx.reply(arg ? `\`${Buffer.from(arg).toString('base64')}\`` : 'Usage: /b64encode hello', { parse_mode: 'Markdown' });
                    case 'b64decode': {
                        try { return ctx.reply(`\`${Buffer.from(arg, 'base64').toString()}\``, { parse_mode: 'Markdown' }); }
                        catch { return ctx.reply('❌ Invalid'); }
                    }
                    case 'binary': { const n = parseInt(arg); return isNaN(n) ? ctx.reply('Usage: /binary 42') : ctx.reply(`🔢 \`${n.toString(2)}\``, { parse_mode: 'Markdown' }); }
                    case 'hex': { const n = parseInt(arg); return isNaN(n) ? ctx.reply('Usage: /hex 255') : ctx.reply(`🔢 \`${n.toString(16).toUpperCase()}\``, { parse_mode: 'Markdown' }); }
                    case 'octal': { const n = parseInt(arg); return isNaN(n) ? ctx.reply('Usage: /octal 64') : ctx.reply(`🔢 \`${n.toString(8)}\``, { parse_mode: 'Markdown' }); }
                    case 'primes': {
                        const n = Math.min(parseInt(arg) || 20, 500);
                        const primes = [];
                        for (let i = 2; i <= n; i++) { let p = true; for (let j = 2; j <= Math.sqrt(i); j++) if (i % j === 0) { p = false; break; } if (p) primes.push(i); }
                        return ctx.reply(`🔢 Primes up to ${n}:\n\`${primes.join(', ')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'fibonacci': {
                        const n = Math.min(parseInt(arg) || 10, 50);
                        const fib = [0, 1];
                        for (let i = 2; i < n; i++) fib.push(fib[i - 1] + fib[i - 2]);
                        return ctx.reply(`🔢 \`${fib.slice(0, n).join(', ')}\``, { parse_mode: 'Markdown' });
                    }
                    case 'factorial': {
                        const n = parseInt(arg);
                        if (isNaN(n) || n < 0 || n > 170) return ctx.reply('Usage: /factorial 5');
                        let r = 1n;
                        for (let i = 2n; i <= BigInt(n); i++) r *= i;
                        return ctx.reply(`🔢 ${n}! = \`${r}\``, { parse_mode: 'Markdown' });
                    }
                    case 'gcd': {
                        const a = arg.split(/\s+/).map(Number);
                        if (a.length < 2) return ctx.reply('Usage: /gcd 12 18');
                        const gcd = (x, y) => y ? gcd(y, x % y) : x;
                        return ctx.reply(`🔢 GCD: \`${a.reduce(gcd)}\``, { parse_mode: 'Markdown' });
                    }
                    case 'bmi': {
                        const p = arg.split(' ');
                        const w = parseFloat(p[0]), h = parseFloat(p[1]);
                        if (!w || !h) return ctx.reply('Usage: /bmi 70 1.75');
                        const bmi = (w / (h * h)).toFixed(1);
                        return ctx.reply(`⚖️ BMI: ${bmi} — ${bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal ✅' : bmi < 30 ? 'Overweight' : 'Obese'}`);
                    }
                    case 'tip': {
                        const p = arg.split(' ');
                        const bill = parseFloat(p[0]), pct = parseFloat(p[1]) || 10;
                        if (!bill) return ctx.reply('Usage: /tip 5000 15');
                        return ctx.reply(`💵 Bill: ${bill}\nTip: ${(bill * pct / 100).toFixed(2)}\nTotal: ${(bill + bill * pct / 100).toFixed(2)}`);
                    }
                    case 'split': {
                        const p = arg.split(' ');
                        const bill = parseFloat(p[0]), people = parseInt(p[1]);
                        if (!bill || !people) return ctx.reply('Usage: /split 10000 4');
                        return ctx.reply(`💵 ${(bill / people).toFixed(2)} each`);
                    }
                    case 'percent': {
                        const p = arg.split(' ');
                        const num = parseFloat(p[0]), pct = parseFloat(p[1]);
                        if (!num || !pct) return ctx.reply('Usage: /percent 500 15');
                        return ctx.reply(`📊 ${pct}% of ${num} = ${(num * pct / 100).toFixed(2)}`);
                    }
                    case 'strength': {
                        if (!arg) return ctx.reply('Usage: /strength MyPass123');
                        const score = [arg.length >= 8, arg.length >= 12, /[a-z]/.test(arg), /[A-Z]/.test(arg), /[0-9]/.test(arg), /[^a-zA-Z0-9]/.test(arg)].filter(Boolean).length;
                        return ctx.reply(`🔐 Strength: ${score >= 5 ? 'Very Strong 🟢' : score >= 4 ? 'Strong 🟡' : score >= 3 ? 'Medium 🟠' : 'Weak 🔴'}`);
                    }
                    case 'scamcheck': {
                        const t = arg.toLowerCase();
                        const flags = [];
                        if (/urgent|immediately/.test(t)) flags.push('Urgency');
                        if (/click here/.test(t)) flags.push('Click bait');
                        if (/otp|password|pin|cvv/.test(t)) flags.push('Sensitive info');
                        if (/won|winner|prize/.test(t)) flags.push('Prize bait');
                        return ctx.reply(`🔍 Red flags: ${flags.length ? flags.join(', ') : '✅ None'}`);
                    }
                    case 'linkcheck': {
                        const u = arg.toLowerCase();
                        const flags = [];
                        if (/bit\.ly|tinyurl|t\.co/.test(u)) flags.push('Shortener');
                        if (/\.tk|\.ml|\.ga|\.cf/.test(u)) flags.push('Risky TLD');
                        if (!/^https:\/\//.test(u)) flags.push('Not HTTPS');
                        return ctx.reply(`🔗 ${flags.length ? '⚠️ ' + flags.join(', ') : '✅ No risks'}`);
                    }
                    case 'randpin': {
                        const len = Math.min(parseInt(arg) || 6, 12);
                        let pin = '';
                        for (let i = 0; i < len; i++) pin += Math.floor(Math.random() * 10);
                        return ctx.reply(`🔢 \`${pin}\``, { parse_mode: 'Markdown' });
                    }
                    case 'otp': return ctx.reply('🔐 Never share an OTP. Banks never ask for it over the phone.');
                    case 'linuxcmd': {
                        const c = arg.toLowerCase();
                        const cmds = { 'ls': 'List files', 'cd': 'Change dir', 'pwd': 'Print working dir', 'chmod': 'Change permissions', 'grep': 'Search text', 'ssh': 'Remote connect', 'tar': 'Archive files', 'curl': 'Transfer data' };
                        return ctx.reply(cmds[c] ? `🐧 ${c}: ${cmds[c]}` : 'Try: ls, cd, pwd, chmod, grep, ssh, tar, curl');
                    }
                    case 'age': {
                        const d = new Date(arg);
                        if (isNaN(d)) return ctx.reply('Usage: /age 2000-01-15');
                        let years = new Date().getFullYear() - d.getFullYear();
                        const m = new Date().getMonth() - d.getMonth();
                        if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) years--;
                        return ctx.reply(`🎂 Age: ${years} years`);
                    }
                    case 'daysuntil': {
                        const d = new Date(arg);
                        if (isNaN(d)) return ctx.reply('Usage: /daysuntil 2026-12-25');
                        const days = Math.ceil((d - new Date()) / 86400000);
                        return ctx.reply(days < 0 ? `Was ${-days} days ago` : `⏳ ${days} days`);
                    }
                    case 'countdown': {
                        const d = new Date(arg);
                        if (isNaN(d)) return ctx.reply('Usage: /countdown 2026-12-31');
                        const days = Math.ceil((d - new Date()) / 86400000);
                        return ctx.reply(days < 0 ? `Was ${-days} days ago` : `⏳ ${days} days left`);
                    }
                    case 'unixtime': return ctx.reply(`🕐 \`${Math.floor(Date.now() / 1000)}\``, { parse_mode: 'Markdown' });
                    case 'hexcolor': {
                        const hex = arg.replace('#', '');
                        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return ctx.reply('Usage: /hexcolor FF5733');
                        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
                        return ctx.reply(`🎨 *#${hex.toUpperCase()}*\nRGB: ${r}, ${g}, ${b}`, { parse_mode: 'Markdown' });
                    }
                    case 'rgb': {
                        const a = arg.split(/[\s,]+/).map(Number);
                        if (a.length < 3 || a.some(isNaN)) return ctx.reply('Usage: /rgb 255 87 51');
                        return ctx.reply(`🎨 \`#${a.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()}\``, { parse_mode: 'Markdown' });
                    }
                    case 'ship': {
                        const n = arg.split(/\s+and\s+|\s*\+\s*/i);
                        if (n.length < 2) return ctx.reply('Usage: /ship John and Mary');
                        return ctx.reply(`💘 ${n[0].trim()} × ${n[1].trim()}\n${Math.floor(Math.random() * 100) + 1}%`);
                    }
                    case 'rate': return ctx.reply(`⭐ ${arg || 'it'}: ${Math.floor(Math.random() * 10) + 1}/10`);
                    case 'mood': return ctx.reply(arg ? `💭 Mood logged: ${arg}` : 'Usage: /mood happy');
                    case 'goal': return arg ? ctx.reply(`🎯 Goal: ${arg}`) : ctx.reply('Usage: /goal finish project');
                    case 'mygoal': return ctx.reply('Use /goal to set a goal.');
                    case 'pick': {
                        const o = arg.split(',').filter(Boolean);
                        return o.length < 2 ? ctx.reply('Usage: /pick pizza, burger') : ctx.reply(`🎯 ${rand(o).trim()}`);
                    }
                    case 'roll': {
                        const m = arg.match(/^(\d+)d(\d+)$/);
                        if (!m) return ctx.reply('Usage: /roll 2d6');
                        let total = 0;
                        for (let i = 0; i < Math.min(parseInt(m[1]), 20); i++) total += Math.floor(Math.random() * parseInt(m[2])) + 1;
                        return ctx.reply(`🎲 Total: ${total}`);
                    }
                    case 'ping': { const t = Date.now(); await ctx.reply('🏓 Pong!'); return ctx.reply(`⚡ ${Date.now() - t}ms`); }
                    case 'menu': return ctx.reply(`🤖 *Commands:*\n\n${enabled.map(c => '/' + c).join('\n')}`, { parse_mode: 'Markdown' });
                    default: return ctx.reply('✅ Command works');
                }
            } catch (e) { ctx.reply('❌ Error: ' + e.message); }
        });
    });

    // Register custom user commands
    Object.keys(customCmds).forEach(customId => {
        bot.command(customId, ctx => {
            track('custom_' + customId);
            ctx.reply(customCmds[customId]);
        });
    });

    bot.on('text', ctx => {
        if (ctx.message.text.startsWith('/')) ctx.reply('❌ Unknown command. Type /menu');
    });

    bot.launch().then(() => console.log(`✅ Bot for ${user.email}`)).catch(e => console.error(`❌ ${user.email}:`, e.message));
    activeBots.set(user.id, bot);
}

db.all(`SELECT * FROM users WHERE bot_token IS NOT NULL`, [], (err, rows) => {
    if (err) return console.error(err);
    rows.forEach(user => buildBot(user));
    console.log(`🚀 Launched ${rows.length} bots`);
});

// ===== ROUTES =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Email and password (min 6 chars) required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (email, password) VALUES (?, ?)`, [email, hash], function(err) {
            if (err) return res.status(400).json({ error: 'Email already registered' });
            req.session.userId = this.lastID;
            res.json({ success: true });
        });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Invalid email or password' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });
        req.session.userId = user.id;
        req.session.isAdmin = user.email === ADMIN_EMAIL;
        res.json({ success: true, isAdmin: req.session.isAdmin });
    });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.get(`SELECT id, email, bot_username, enabled_commands, welcome_message, custom_commands FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        user.isAdmin = user.email === ADMIN_EMAIL;
        res.json(user);
    });
});

app.get('/api/commands', (req, res) => res.json(AVAILABLE_COMMANDS));

// Save bot settings
app.post('/api/bot/settings', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { bot_token, enabled_commands, welcome_message, custom_commands } = req.body;

    if (!bot_token || !bot_token.match(/^\d+:[A-Za-z0-9_-]+$/)) return res.status(400).json({ error: 'Invalid bot token format' });

    axios.get(`https://api.telegram.org/bot${bot_token}/getMe`)
        .then(response => {
            if (!response.data.ok) return res.status(400).json({ error: 'Invalid bot token' });
            const username = response.data.result.username;
            db.run(`UPDATE users SET bot_token = ?, bot_username = ?, enabled_commands = ?, welcome_message = ?, custom_commands = ? WHERE id = ?`,
                [bot_token, username, JSON.stringify(enabled_commands), welcome_message || null, JSON.stringify(custom_commands || {}), req.session.userId],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
                        if (!err && user) buildBot(user);
                    });
                    res.json({ success: true, username });
                });
        })
        .catch(() => res.status(400).json({ error: 'Could not verify bot token' }));
});

// Analytics — user's own
app.get('/api/analytics', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.all(`SELECT command, COUNT(*) as count FROM command_usage WHERE user_id = ? GROUP BY command ORDER BY count DESC LIMIT 10`,
        [req.session.userId], (err, rows) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            db.get(`SELECT COUNT(*) as total FROM command_usage WHERE user_id = ?`, [req.session.userId], (err2, totalRow) => {
                res.json({ top: rows, total: totalRow?.total || 0 });
            });
        });
});

// ===== ADMIN ROUTES =====
function requireAdmin(req, res, next) {
    if (!req.session.userId || !req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
    next();
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all(`SELECT id, email, bot_username, created_at, (SELECT COUNT(*) FROM command_usage WHERE user_id = users.id) as usage_count FROM users ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json(rows);
    });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    if (activeBots.has(id)) { try { activeBots.get(id).stop(); } catch (e) {} activeBots.delete(id); }
    db.run(`DELETE FROM users WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ error: 'Delete failed' });
        res.json({ success: true });
    });
});

app.post('/api/admin/restart/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        if (user.bot_token) buildBot(user);
        res.json({ success: true });
    });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as total_users FROM users`, [], (e1, u) => {
        db.get(`SELECT COUNT(*) as total_bots FROM users WHERE bot_token IS NOT NULL`, [], (e2, b) => {
            db.get(`SELECT COUNT(*) as total_uses FROM command_usage`, [], (e3, c) => {
                res.json({ users: u?.total_users || 0, bots: b?.total_bots || 0, commands_used: c?.total_uses || 0 });
            });
        });
    });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Server running on port ${PORT}`));
