require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@xitexe.com';

// ===== DATABASE =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
        ? { rejectUnauthorized: false }
        : false
});

// Init tables
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                bot_token TEXT,
                bot_username TEXT,
                enabled_commands TEXT DEFAULT '["joke","fact","dice","time","calc","password","quote","coinflip","8ball","menu"]',
                welcome_message TEXT,
                custom_commands TEXT DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS command_usage (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                command TEXT NOT NULL,
                used_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                sid VARCHAR NOT NULL PRIMARY KEY,
                sess JSON NOT NULL,
                expire TIMESTAMP(6) NOT NULL
            );
        `);
        console.log('✅ Database ready');
    } catch (e) {
        console.error('DB init error:', e.message);
    }
})();

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    store: new PgSession({ pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ===== COMMANDS =====
const AVAILABLE_COMMANDS = [
    { id: 'joke', name: 'Random joke', category: 'fun' },
    { id: 'quote', name: 'Random quote', category: 'fun' },
    { id: 'fact', name: 'Random fact', category: 'fun' },
    { id: 'dice', name: 'Roll dice', category: 'fun' },
    { id: 'coinflip', name: 'Coin flip', category: 'fun' },
    { id: '8ball', name: 'Magic 8-ball', category: 'fun' },
    { id: 'riddle', name: 'Riddle', category: 'fun' },
    { id: 'truth', name: 'Truth question', category: 'fun' },
    { id: 'dare', name: 'Dare challenge', category: 'fun' },
    { id: 'roast', name: 'Roast', category: 'fun' },
    { id: 'compliment', name: 'Compliment', category: 'fun' },
    { id: 'vibe', name: 'Vibe check', category: 'fun' },
    { id: 'lucky', name: 'Lucky number', category: 'fun' },
    { id: 'yesno', name: 'Yes/No', category: 'fun' },
    { id: 'wouldyourather', name: 'Would you rather', category: 'fun' },
    { id: 'time', name: 'Current time', category: 'utility' },
    { id: 'date', name: 'Today date', category: 'utility' },
    { id: 'week', name: 'Day of week', category: 'utility' },
    { id: 'month', name: 'Current month', category: 'utility' },
    { id: 'calc', name: 'Calculator', category: 'utility' },
    { id: 'random', name: 'Random number', category: 'utility' },
    { id: 'password', name: 'Generate password', category: 'utility' },
    { id: 'genpass', name: 'Secure password', category: 'utility' },
    { id: 'uuid', name: 'UUID generator', category: 'utility' },
    { id: 'reverse', name: 'Reverse text', category: 'utility' },
    { id: 'upper', name: 'Uppercase', category: 'utility' },
    { id: 'lower', name: 'Lowercase', category: 'utility' },
    { id: 'len', name: 'Length counter', category: 'utility' },
    { id: 'count', name: 'Text stats', category: 'utility' },
    { id: 'spell', name: 'Spell letters', category: 'utility' },
    { id: 'alternate', name: 'Alternate case', category: 'utility' },
    { id: 'titlecase', name: 'Title Case', category: 'utility' },
    { id: 'slugify', name: 'Slugify text', category: 'utility' },
    { id: 'shuffle', name: 'Shuffle letters', category: 'utility' },
    { id: 'rotate', name: 'Rotate text', category: 'utility' },
    { id: 'caesar', name: 'Caesar cipher', category: 'utility' },
    { id: 'vowels', name: 'Vowel count', category: 'utility' },
    { id: 'morse', name: 'Text to Morse', category: 'utility' },
    { id: 'sha256', name: 'SHA256 hash', category: 'utility' },
    { id: 'md5', name: 'MD5 hash', category: 'utility' },
    { id: 'b64encode', name: 'Base64 encode', category: 'utility' },
    { id: 'b64decode', name: 'Base64 decode', category: 'utility' },
    { id: 'binary', name: 'To binary', category: 'utility' },
    { id: 'hex', name: 'To hex', category: 'utility' },
    { id: 'octal', name: 'To octal', category: 'utility' },
    { id: 'primes', name: 'Prime numbers', category: 'utility' },
    { id: 'fibonacci', name: 'Fibonacci', category: 'utility' },
    { id: 'factorial', name: 'Factorial', category: 'utility' },
    { id: 'gcd', name: 'GCD', category: 'utility' },
    { id: 'bmi', name: 'BMI calculator', category: 'utility' },
    { id: 'tip', name: 'Tip calculator', category: 'utility' },
    { id: 'split', name: 'Split bill', category: 'utility' },
    { id: 'percent', name: 'Percentage', category: 'utility' },
    { id: 'strength', name: 'Password strength', category: 'security' },
    { id: 'scamcheck', name: 'Scam analysis', category: 'security' },
    { id: 'linkcheck', name: 'Link safety', category: 'security' },
    { id: 'sectips', name: 'Security tip', category: 'security' },
    { id: 'phishing', name: 'Phishing tips', category: 'security' },
    { id: 'randpin', name: 'Random PIN', category: 'security' },
    { id: 'otp', name: 'OTP safety', category: 'security' },
    { id: 'linuxcmd', name: 'Linux command help', category: 'security' },
    { id: 'age', name: 'Age calculator', category: 'utility' },
    { id: 'daysuntil', name: 'Days until date', category: 'utility' },
    { id: 'countdown', name: 'Countdown', category: 'utility' },
    { id: 'unixtime', name: 'Unix timestamp', category: 'utility' },
    { id: 'hexcolor', name: 'Hex color info', category: 'utility' },
    { id: 'rgb', name: 'RGB to hex', category: 'utility' },
    { id: 'ship', name: 'Ship calculator', category: 'fun' },
    { id: 'rate', name: 'Rate something', category: 'fun' },
    { id: 'advice', name: 'Random advice', category: 'fun' },
    { id: 'mood', name: 'Mood check', category: 'fun' },
    { id: 'goal', name: 'Set daily goal', category: 'utility' },
    { id: 'mygoal', name: 'Show goal', category: 'utility' },
    { id: 'menu', name: 'Show menu', category: 'info' },
    { id: 'ping', name: 'Check latency', category: 'info' }
];

const TEMPLATES = {
    fun: ['joke','quote','fact','dice','coinflip','8ball','truth','dare','roast','compliment','vibe'],
    utility: ['time','date','calc','random','password','uuid','reverse','upper','lower','bmi','tip','split'],
    security: ['strength','scamcheck','linkcheck','sectips','phishing','randpin','otp']
};

const activeBots = new Map();

const DATA = {
    joke: ["Why do programmers prefer dark mode? Light attracts bugs 🐛","Why did the dev go broke? He used up all his cache 💸"],
    quote: ["The best way to predict the future is to invent it. — Alan Kay","Code is like humor. When you have to explain it, it's bad. — Cory House"],
    fact: ["Octopuses have three hearts 🐙","Honey never spoils 🍯"],
    truth: ["What's your most embarrassing moment?","Who's your secret crush?"],
    dare: ["Send the last photo in your gallery.","Type your name with your eyes closed."],
    roast: ["You're the reason they put instructions on shampoo bottles.","Your code is like your face — buggy."],
    compliment: ["You're doing great.","Your existence makes the world better."],
    vibe: ["🔥 Immaculate vibes.","✨ Chill vibes.","⚡ Chaotic energy."],
    sectips: ["*Tip:* Use a password manager.","*Tip:* Enable 2FA."],
    phishing: ["*Signs:* Urgent language, wrong domain.","*Rule:* Never enter passwords into a link."],
    advice: ["Talk less. Listen more.","Save 10% of everything you earn."],
    wouldyourather: ["Fight 1 horse-sized duck OR 100 duck-sized horses?","Always be 10 min late OR 20 min early?"]
};

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// ===== BOT BUILDER =====
function buildBot(user) {
    if (activeBots.has(user.id)) {
        try { activeBots.get(user.id).stop(); } catch (e) {}
        activeBots.delete(user.id);
    }

    const bot = new Telegraf(user.bot_token);
    const enabled = JSON.parse(user.enabled_commands || '[]');
    const customCmds = JSON.parse(user.custom_commands || '{}');

    const track = (cmd) => {
        pool.query(`INSERT INTO command_usage (user_id, command) VALUES ($1, $2)`, [user.id, cmd]).catch(() => {});
    };

    // Build inline keyboard menu
    const buildKeyboard = () => {
        const rows = [];
        for (let i = 0; i < enabled.length; i += 3) {
            const row = enabled.slice(i, i + 3).map(cmd =>
                Markup.button.callback('/' + cmd, 'cmd_' + cmd)
            );
            rows.push(row);
        }
        return Markup.inlineKeyboard(rows);
    };

    bot.start(ctx => {
        const welcome = user.welcome_message || `👋 Welcome ${ctx.from.first_name}!\n\nTap a command below or type /menu`;
        ctx.reply(welcome, buildKeyboard());
    });

    bot.command('menu', ctx => {
        ctx.reply('🤖 *Available commands:*\n\nTap any button to run it.', { parse_mode: 'Markdown', ...buildKeyboard() });
    });

    // Handle button taps
    bot.action(/^cmd_(.+)$/, async ctx => {
        const cmd = ctx.match[1];
        if (!enabled.includes(cmd)) return ctx.answerCbQuery('Not available');
        await ctx.answerCbQuery();
        track(cmd);
        // Fake a message to reuse the switch logic
        ctx.message = { text: '/' + cmd };
        await handleCommand(cmd, ctx, '');
    });

    // Register text commands
    enabled.forEach(cmd => {
        bot.command(cmd, async ctx => {
            track(cmd);
            const arg = ctx.message.text.replace('/' + cmd, '').trim();
            await handleCommand(cmd, ctx, arg);
        });
    });

    // Custom commands
    Object.keys(customCmds).forEach(cid => {
        bot.command(cid, ctx => {
            track('custom_' + cid);
            ctx.reply(customCmds[cid]);
        });
    });

    bot.on('text', ctx => {
        if (ctx.message.text.startsWith('/')) ctx.reply('❌ Unknown command. Type /menu');
    });

    bot.launch().then(() => console.log(`✅ Bot for ${user.email}`)).catch(e => console.error(`❌ ${user.email}:`, e.message));
    activeBots.set(user.id, bot);
}

// ===== COMMAND HANDLER =====
async function handleCommand(cmd, ctx, arg) {
    try {
        switch (cmd) {
            case 'joke': case 'quote': case 'fact': case 'truth': case 'dare':
            case 'roast': case 'compliment': case 'vibe': case 'sectips':
            case 'phishing': case 'advice': case 'wouldyourather':
                return ctx.reply('✨ ' + rand(DATA[cmd]));
            case 'dice': return ctx.reply(`🎲 ${Math.floor(Math.random() * 6) + 1}`);
            case 'coinflip': return ctx.reply(Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙');
            case '8ball': return ctx.reply('🎱 ' + rand(["Yes ✅","No ❌","Maybe 🤔","Definitely 💯"]));
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
            case 'month': return ctx.reply(`📅 ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date().getMonth()]}`);
            case 'calc': {
                if (!arg) return ctx.reply('Usage: /calc 2+2');
                if (!/^[0-9+\-*/().\s]+$/.test(arg)) return ctx.reply('❌ Only numbers');
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
            case 'slugify': return ctx.reply(arg ? `\`${arg.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`` : 'Usage', { parse_mode: 'Markdown' });
            case 'shuffle': {
                if (!arg) return ctx.reply('Usage: /shuffle hello');
                const arr = arg.split('');
                for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
                return ctx.reply(`🔀 ${arr.join('')}`);
            }
            case 'rotate': return ctx.reply(arg ? `🔄 ${arg.slice(1)}${arg[0]}` : 'Usage');
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
                return ctx.reply(`🔤 Vowels: ${v}`);
            }
            case 'morse': {
                const t = arg.toLowerCase();
                const map = { a:'.-', b:'-...', c:'-.-.', d:'-..', e:'.', f:'..-.', g:'--.', h:'....', i:'..', j:'.---', k:'-.-', l:'.-..', m:'--', n:'-.', o:'---', p:'.--.', q:'--.-', r:'.-.', s:'...', t:'-', u:'..-', v:'...-', w:'.--', x:'-..-', y:'-.--', z:'--..', ' ':'/' };
                return ctx.reply(`📡 \`${t.split('').map(c => map[c] || c).join(' ')}\``, { parse_mode: 'Markdown' });
            }
            case 'sha256': return ctx.reply(arg ? `🔐 \`${crypto.createHash('sha256').update(arg).digest('hex')}\`` : 'Usage', { parse_mode: 'Markdown' });
            case 'md5': return ctx.reply(arg ? `🔐 \`${crypto.createHash('md5').update(arg).digest('hex')}\`` : 'Usage', { parse_mode: 'Markdown' });
            case 'b64encode': return ctx.reply(arg ? `\`${Buffer.from(arg).toString('base64')}\`` : 'Usage', { parse_mode: 'Markdown' });
            case 'b64decode': try { return ctx.reply(`\`${Buffer.from(arg, 'base64').toString()}\``, { parse_mode: 'Markdown' }); } catch { return ctx.reply('❌ Invalid'); }
            case 'binary': { const n = parseInt(arg); return isNaN(n) ? ctx.reply('Usage: /binary 42') : ctx.reply(`🔢 \`${n.toString(2)}\``, { parse_mode: 'Markdown' }); }
            case 'hex': { const n = parseInt(arg); return isNaN(n) ? ctx.reply('Usage: /hex 255') : ctx.reply(`🔢 \`${n.toString(16).toUpperCase()}\``, { parse_mode: 'Markdown' }); }
            case 'octal': { const n = parseInt(arg); return isNaN(n) ? ctx.reply('Usage') : ctx.reply(`🔢 \`${n.toString(8)}\``, { parse_mode: 'Markdown' }); }
            case 'primes': {
                const n = Math.min(parseInt(arg) || 20, 500);
                const primes = [];
                for (let i = 2; i <= n; i++) { let p = true; for (let j = 2; j <= Math.sqrt(i); j++) if (i % j === 0) { p = false; break; } if (p) primes.push(i); }
                return ctx.reply(`🔢 \`${primes.join(', ')}\``, { parse_mode: 'Markdown' });
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
                return ctx.reply(`🔢 \`${a.reduce(gcd)}\``, { parse_mode: 'Markdown' });
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
                if (/otp|password|pin/.test(t)) flags.push('Sensitive info');
                if (/won|winner|prize/.test(t)) flags.push('Prize bait');
                return ctx.reply(`🔍 ${flags.length ? flags.join(', ') : '✅ None'}`);
            }
            case 'linkcheck': {
                const u = arg.toLowerCase();
                const flags = [];
                if (/bit\.ly|tinyurl/.test(u)) flags.push('Shortener');
                if (!/^https:\/\//.test(u)) flags.push('Not HTTPS');
                return ctx.reply(`🔗 ${flags.length ? flags.join(', ') : '✅ No risks'}`);
            }
            case 'randpin': {
                const len = Math.min(parseInt(arg) || 6, 12);
                let pin = '';
                for (let i = 0; i < len; i++) pin += Math.floor(Math.random() * 10);
                return ctx.reply(`🔢 \`${pin}\``, { parse_mode: 'Markdown' });
            }
            case 'otp': return ctx.reply('🔐 Never share an OTP. Banks never ask over the phone.');
            case 'linuxcmd': {
                const c = arg.toLowerCase();
                const cmds = { 'ls': 'List files', 'cd': 'Change dir', 'pwd': 'Print working dir', 'chmod': 'Permissions', 'grep': 'Search text', 'ssh': 'Remote connect', 'tar': 'Archive', 'curl': 'Transfer' };
                return ctx.reply(cmds[c] ? `🐧 ${c}: ${cmds[c]}` : 'Try: ls, cd, pwd, chmod, grep, ssh, tar, curl');
            }
            case 'age': {
                const d = new Date(arg);
                if (isNaN(d)) return ctx.reply('Usage: /age 2000-01-15');
                let years = new Date().getFullYear() - d.getFullYear();
                const m = new Date().getMonth() - d.getMonth();
                if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) years--;
                return ctx.reply(`🎂 ${years} years`);
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
                return ctx.reply(days < 0 ? `Was ${-days} days ago` : `⏳ ${days} days`);
            }
            case 'unixtime': return ctx.reply(`🕐 \`${Math.floor(Date.now() / 1000)}\``, { parse_mode: 'Markdown' });
            case 'hexcolor': {
                const hex = arg.replace('#', '');
                if (!/^[0-9a-fA-F]{6}$/.test(hex)) return ctx.reply('Usage: /hexcolor FF5733');
                return ctx.reply(`🎨 *#${hex.toUpperCase()}*`, { parse_mode: 'Markdown' });
            }
            case 'rgb': {
                const a = arg.split(/[\s,]+/).map(Number);
                if (a.length < 3) return ctx.reply('Usage: /rgb 255 87 51');
                return ctx.reply(`🎨 \`#${a.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()}\``, { parse_mode: 'Markdown' });
            }
            case 'ship': {
                const n = arg.split(/\s+and\s+|\s*\+\s*/i);
                if (n.length < 2) return ctx.reply('Usage: /ship John and Mary');
                return ctx.reply(`💘 ${n[0].trim()} × ${n[1].trim()}\n${Math.floor(Math.random() * 100) + 1}%`);
            }
            case 'rate': return ctx.reply(`⭐ ${arg || 'it'}: ${Math.floor(Math.random() * 10) + 1}/10`);
            case 'mood': return ctx.reply(arg ? `💭 ${arg}` : 'Usage: /mood happy');
            case 'goal': return arg ? ctx.reply(`🎯 ${arg}`) : ctx.reply('Usage: /goal finish project');
            case 'mygoal': return ctx.reply('Use /goal');
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
            case 'menu': return ctx.reply('Use /start to see buttons');
            default: return ctx.reply('✅ Works');
        }
    } catch (e) { ctx.reply('❌ Error: ' + e.message); }
}

// ===== LAUNCH EXISTING BOTS =====
pool.query(`SELECT * FROM users WHERE bot_token IS NOT NULL`).then(res => {
    res.rows.forEach(user => buildBot(user));
    console.log(`🚀 Launched ${res.rows.length} bots`);
}).catch(e => console.error(e.message));

// ===== ROUTES =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Email and password (min 6 chars) required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const r = await pool.query(`INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id`, [email, hash]);
        req.session.userId = r.rows[0].id;
        res.json({ success: true });
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ error: 'Email already registered' });
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const r = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
        const user = r.rows[0];
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });
        req.session.userId = user.id;
        req.session.isAdmin = user.email === ADMIN_EMAIL;
        res.json({ success: true, isAdmin: req.session.isAdmin });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const r = await pool.query(`SELECT id, email, bot_username, enabled_commands, welcome_message, custom_commands FROM users WHERE id = $1`, [req.session.userId]);
        if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
        const user = r.rows[0];
        user.isAdmin = user.email === ADMIN_EMAIL;
        res.json(user);
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/commands', (req, res) => res.json(AVAILABLE_COMMANDS));
app.get('/api/templates', (req, res) => res.json(TEMPLATES));

app.post('/api/bot/settings', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { bot_token, enabled_commands, welcome_message, custom_commands } = req.body;
    if (!bot_token || !bot_token.match(/^\d+:[A-Za-z0-9_-]+$/)) return res.status(400).json({ error: 'Invalid bot token' });
    try {
        const r = await axios.get(`https://api.telegram.org/bot${bot_token}/getMe`);
        if (!r.data.ok) return res.status(400).json({ error: 'Invalid bot token' });
        const username = r.data.result.username;
        await pool.query(
            `UPDATE users SET bot_token = $1, bot_username = $2, enabled_commands = $3, welcome_message = $4, custom_commands = $5 WHERE id = $6`,
            [bot_token, username, JSON.stringify(enabled_commands), welcome_message || null, JSON.stringify(custom_commands || {}), req.session.userId]
        );
        const ur = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.session.userId]);
        buildBot(ur.rows[0]);
        res.json({ success: true, username });
    } catch (e) {
        res.status(400).json({ error: 'Could not verify bot token' });
    }
});

app.get('/api/analytics', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const top = await pool.query(`SELECT command, COUNT(*) as count FROM command_usage WHERE user_id = $1 GROUP BY command ORDER BY count DESC LIMIT 10`, [req.session.userId]);
        const total = await pool.query(`SELECT COUNT(*) as total FROM command_usage WHERE user_id = $1`, [req.session.userId]);
        res.json({ top: top.rows, total: parseInt(total.rows[0]?.total || 0) });
    } catch (e) { res.status(500).json({ error: 'DB error' }); }
});

// Profile routes
app.post('/api/profile/email', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { email, password } = req.body;
    try {
        const r = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.session.userId]);
        const match = await bcrypt.compare(password, r.rows[0].password);
        if (!match) return res.status(400).json({ error: 'Incorrect password' });
        await pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, req.session.userId]);
        res.json({ success: true });
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ error: 'Email already in use' });
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/profile/password', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password min 6 chars' });
    try {
        const r = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.session.userId]);
        const match = await bcrypt.compare(oldPassword, r.rows[0].password);
        if (!match) return res.status(400).json({ error: 'Incorrect current password' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, req.session.userId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/profile/delete', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { password } = req.body;
    try {
        const r = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.session.userId]);
        const match = await bcrypt.compare(password, r.rows[0].password);
        if (!match) return res.status(400).json({ error: 'Incorrect password' });
        if (activeBots.has(req.session.userId)) { try { activeBots.get(req.session.userId).stop(); } catch (e) {} activeBots.delete(req.session.userId); }
        await pool.query(`DELETE FROM users WHERE id = $1`, [req.session.userId]);
        await pool.query(`DELETE FROM command_usage WHERE user_id = $1`, [req.session.userId]);
        req.session.destroy();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Admin routes
function requireAdmin(req, res, next) {
    if (!req.session.userId || !req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
    next();
}

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query(`SELECT id, email, bot_username, created_at, (SELECT COUNT(*) FROM command_usage WHERE user_id = users.id) as usage_count FROM users ORDER BY created_at DESC`);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: 'DB error' }); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    if (activeBots.has(id)) { try { activeBots.get(id).stop(); } catch (e) {} activeBots.delete(id); }
    try {
        await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
        await pool.query(`DELETE FROM command_usage WHERE user_id = $1`, [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Delete failed' }); }
});

app.post('/api/admin/restart/:id', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query(`SELECT * FROM users WHERE id = $1`, [parseInt(req.params.id)]);
        if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
        if (r.rows[0].bot_token) buildBot(r.rows[0]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Restart failed' }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const u = await pool.query(`SELECT COUNT(*) FROM users`);
        const b = await pool.query(`SELECT COUNT(*) FROM users WHERE bot_token IS NOT NULL`);
        const c = await pool.query(`SELECT COUNT(*) FROM command_usage`);
        res.json({ users: parseInt(u.rows[0].count), bots: parseInt(b.rows[0].count), commands_used: parseInt(c.rows[0].count) });
    } catch (e) { res.status(500).json({ error: 'DB error' }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Server running on port ${PORT}`));
