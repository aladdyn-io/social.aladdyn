// ANSI color codes for terminal output
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};

const SERVICE_STYLES: Record<string, { fg: string; bg: string; icon: string; label: string }> = {
  'on-demand-compositor': { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🎨', label: 'COMPOSITOR' },
  'layout-director':      { fg: '\x1b[37m', bg: '\x1b[45m', icon: '📐', label: 'LAYOUT' },
  'html-renderer':        { fg: '\x1b[37m', bg: '\x1b[44m', icon: '📄', label: 'RENDERER' },
  'saliency-analyzer':    { fg: '\x1b[30m', bg: '\x1b[43m', icon: '👁️', label: 'SALIENCY' },
  'color-analyzer':       { fg: '\x1b[30m', bg: '\x1b[43m', icon: '🎨', label: 'COLORS' },
  'quality-evaluator':    { fg: '\x1b[30m', bg: '\x1b[42m', icon: '✨', label: 'QUALITY' },
  'subject-masker':       { fg: '\x1b[30m', bg: '\x1b[42m', icon: '🎭', label: 'MASKER' },
  'token-service':        { fg: '\x1b[37m', bg: '\x1b[45m', icon: '🪙', label: 'TOKENS' },
  'smart-llm-client':     { fg: '\x1b[37m', bg: '\x1b[100m', icon: '🤖', label: 'LLM-CLIENT' },
  'image-gen-worker':     { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🖼️', label: 'IMAGE-GEN' },
  'video-gen-worker':     { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🎥', label: 'VIDEO-GEN' },
  'publish-worker':       { fg: '\x1b[37m', bg: '\x1b[44m', icon: '📤', label: 'PUBLISH' },
  'engagement-poller':    { fg: '\x1b[37m', bg: '\x1b[100m', icon: '📊', label: 'POLLER' },
  'scheduler':            { fg: '\x1b[37m', bg: '\x1b[100m', icon: '⏰', label: 'SCHEDULER' },
  'content-pipeline':     { fg: '\x1b[30m', bg: '\x1b[46m', icon: '⚡', label: 'PIPELINE' },
  'strategy-agent-sequence': { fg: '\x1b[37m', bg: '\x1b[44m', icon: '🧠', label: 'STRATEGY' },
  'campaign-orchestrator': { fg: '\x1b[37m', bg: '\x1b[44m', icon: '🎼', label: 'CAMPAIGN' },
  'on-demand-video':      { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🎬', label: 'ON-DEMAND-VID' },
  'kling-video-generator': { fg: '\x1b[37m', bg: '\x1b[45m', icon: '🔮', label: 'KLING' },
  'api':                  { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🌐', label: 'API' },
  'api-server':           { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🌐', label: 'API-SERVER' },
  'post-management':      { fg: '\x1b[37m', bg: '\x1b[44m', icon: '📝', label: 'POSTS' },
  'postmanagement':       { fg: '\x1b[37m', bg: '\x1b[44m', icon: '📝', label: 'POSTS' },
  'prisma':               { fg: '\x1b[37m', bg: '\x1b[100m', icon: '💾', label: 'PRISMA' },
  'database':             { fg: '\x1b[37m', bg: '\x1b[100m', icon: '💾', label: 'DATABASE' },
  'festivalapi':          { fg: '\x1b[30m', bg: '\x1b[46m', icon: '🎡', label: 'FESTIVAL-API' },
  'generatecalendar':     { fg: '\x1b[37m', bg: '\x1b[45m', icon: '📅', label: 'CALENDAR' },
  'objectstorage':        { fg: '\x1b[37m', bg: '\x1b[100m', icon: '📦', label: 'STORAGE' },
  'app':                  { fg: '\x1b[37m', bg: '\x1b[100m', icon: '🚀', label: 'APP' },
};

const LEVEL_STYLES: Record<string, { color: string; label: string; icon: string }> = {
  info:  { color: C.green,  label: 'INFO ', icon: 'ℹ️ ' },
  warn:  { color: C.yellow, label: 'WARN ', icon: '⚠️ ' },
  error: { color: C.red,    label: 'ERROR', icon: '🚨 ' },
  debug: { color: C.gray,   label: 'DEBUG', icon: '🔧 ' },
};

// Module-level variable to track execution time delta
let lastHrTime = process.hrtime();

function getDeltaTime(): string {
  const diff = process.hrtime(lastHrTime);
  lastHrTime = process.hrtime();
  const ns = diff[0] * 1e9 + diff[1];
  const ms = ns / 1e6;
  if (ms < 0.1) {
    return `${C.gray}+${(ns / 1e3).toFixed(0)}μs${C.reset}`;
  } else if (ms < 1000) {
    return `${C.gray}+${ms.toFixed(1)}ms${C.reset}`;
  } else {
    return `${C.yellow}+${(ms / 1000).toFixed(2)}s${C.reset}`;
  }
}

function getServiceStyle(service: string) {
  const normalized = service.toLowerCase().trim();
  if (SERVICE_STYLES[normalized]) {
    return SERVICE_STYLES[normalized];
  }
  
  // Dynamic fallback styling based on string hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const bgColors = [
    { bg: '\x1b[46m', fg: '\x1b[30m' }, // Cyan (black text)
    { bg: '\x1b[45m', fg: '\x1b[37m' }, // Magenta (white text)
    { bg: '\x1b[44m', fg: '\x1b[37m' }, // Blue (white text)
    { bg: '\x1b[42m', fg: '\x1b[30m' }, // Green (black text)
    { bg: '\x1b[100m', fg: '\x1b[37m' }, // Gray (white text)
    { bg: '\x1b[43m', fg: '\x1b[30m' }, // Yellow (black text)
  ];
  
  const color = bgColors[Math.abs(hash) % bgColors.length];
  const upperLabel = normalized.toUpperCase().replace(/[-_]/g, ' ');
  return {
    fg: color.fg,
    bg: color.bg,
    icon: '⚙️ ',
    label: upperLabel,
  };
}

function formatErrorBox(rawMsg: string, serviceName: string): string {
  const lines = rawMsg.split('\n');
  const header = ` ${C.red}${C.bold}❌ ERROR [${serviceName.toUpperCase()}] ${C.reset}`;
  
  const width = 85;
  const borderTop    = `${C.red}┌${'─'.repeat(width)}┐${C.reset}`;
  const borderMiddle = `${C.red}├${'─'.repeat(width)}┤${C.reset}`;
  const borderBottom = `${C.red}└${'─'.repeat(width)}┘${C.reset}`;
  
  let output = [borderTop];
  output.push(`${C.red}│${C.reset} ${header}${' '.repeat(width - 9 - serviceName.length - 8)} ${C.red}│${C.reset}`);
  output.push(borderMiddle);
  
  for (let line of lines) {
    line = line.trimEnd();
    if (line.match(/^\s*at\s+/)) {
      if (line.includes('social aladdyn') || line.includes('social.aladdyn') || line.includes('src')) {
        line = `${C.white}${C.bold}${line}${C.reset}`;
      } else {
        line = `${C.gray}${C.dim}${line}${C.reset}`;
      }
    } else {
      if (line.includes('→') || line.includes('Invalid `prisma')) {
        line = `${C.yellow}${line}${C.reset}`;
      } else {
        line = `${C.red}${line}${C.reset}`;
      }
    }
    
    const stripAnsi = (s: string) => s.replace(/\x1b\[\d+m/g, '');
    const visibleLen = stripAnsi(line).length;
    
    if (visibleLen <= width - 2) {
      output.push(`${C.red}│${C.reset} ${line}${' '.repeat(width - 2 - visibleLen)} ${C.red}│${C.reset}`);
    } else {
      let remaining = line;
      while (stripAnsi(remaining).length > 0) {
        const plain = stripAnsi(remaining);
        const chunkPlain = plain.slice(0, width - 4);
        let realIndex = 0;
        let plainCharCount = 0;
        while (plainCharCount < chunkPlain.length && realIndex < remaining.length) {
          if (remaining.substring(realIndex).startsWith('\x1b[')) {
            const match = remaining.substring(realIndex).match(/^\x1b\[\d+m/);
            if (match) {
              realIndex += match[0].length;
              continue;
            }
          }
          realIndex++;
          plainCharCount++;
        }
        const chunk = remaining.slice(0, realIndex);
        remaining = remaining.slice(realIndex);
        const chunkVisibleLen = stripAnsi(chunk).length;
        output.push(`${C.red}│${C.reset} ${chunk}${' '.repeat(width - 2 - chunkVisibleLen)} ${C.red}│${C.reset}`);
      }
    }
  }
  output.push(borderBottom);
  return output.join('\n');
}

function processMsgColors(cleanMsg: string, level: string): string {
  // Check if it's an HTTP API log
  const httpMatch = cleanMsg.match(/^(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)(.*)/i);
  if (httpMatch) {
    const method = httpMatch[1].toUpperCase();
    const path = httpMatch[2];
    const suffix = httpMatch[3]; // e.g. " - 304 (875ms)"
    
    let methodBg = '\x1b[46m\x1b[30m';
    if (method === 'GET') { methodBg = '\x1b[42m\x1b[30m'; }
    else if (method === 'POST') { methodBg = '\x1b[43m\x1b[30m'; }
    else if (method === 'PUT') { methodBg = '\x1b[44m\x1b[37m'; }
    else if (method === 'DELETE') { methodBg = '\x1b[41m\x1b[37m'; }
    
    const methodBadge = `${methodBg}  ${method}  ${C.reset}`;
    
    let suffixColored = suffix;
    const statusMatch = suffix.match(/\s*-\s*(\d+)\s*(?:\(([^)]+)\))?/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]);
      const duration = statusMatch[2] ? ` (${statusMatch[2]})` : '';
      let statusColor = C.green;
      if (status >= 400) {
        statusColor = C.red + C.bold;
      } else if (status >= 300) {
        statusColor = C.cyan;
      }
      suffixColored = ` ➜ ${statusColor}${status}${C.reset}${C.gray}${duration}${C.reset}`;
    }
    
    return `${methodBadge} ${C.white}${C.bold}${path}${C.reset}${suffixColored}`;
  }

  // Generic success styling
  if (cleanMsg.includes('✓') || cleanMsg.toLowerCase().includes('success') || cleanMsg.toLowerCase().includes('successfully') || cleanMsg.toLowerCase().includes('passed')) {
    return `${C.green}${C.bold}✓ ${cleanMsg.replace(/^[V✓]\s*/i, '')}${C.reset}`;
  }
  
  // Generic warning styling
  if (level === 'warn' || cleanMsg.toLowerCase().includes('warn') || cleanMsg.toLowerCase().includes('skip') || cleanMsg.includes('?')) {
    return `${C.yellow}${cleanMsg}${C.reset}`;
  }

  // Generic error styling
  if (level === 'error' || cleanMsg.toLowerCase().includes('error') || cleanMsg.toLowerCase().includes('failed')) {
    return `${C.red}${C.bold}${cleanMsg}${C.reset}`;
  }

  return cleanMsg;
}

function formatLog(level: string, msg: string, context: Record<string, string>, meta?: object): string {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
  
  const service = context.service || 'app';
  const style = getServiceStyle(service);
  const ls = LEVEL_STYLES[level] || LEVEL_STYLES.info;
  
  const timeStr = `${C.gray}${time}${C.reset}`;
  const levelStr = `${ls.color}${C.bold}${ls.icon}${ls.label}${C.reset}`;
  const badgeStr = `${style.bg}${style.fg} ${style.icon}${style.label} ${C.reset}`;
  const deltaStr = getDeltaTime();

  // If it's an error line or Prisma error, wrap it in our gorgeous error box
  if (level === 'error' || msg.includes('prisma:error') || msg.includes('Error caught:') || msg.includes('\n    at ')) {
    return formatErrorBox(msg, service);
  }

  const msgStr = processMsgColors(msg, level);

  let metaStr = '';
  if (meta && Object.keys(meta).length > 0) {
    const parts = Object.entries(meta).map(([k, v]) => `${C.gray}${k}=${C.reset}${v}`);
    metaStr = `  ${C.dim}${parts.join(' ')}${C.reset}`;
  }

  return `${timeStr} ${levelStr} [ ${badgeStr} ] ❯ ${msgStr}${metaStr} (${deltaStr})`;
}

export function createLogger(context: Record<string, string>) {
  return {
    info:  (msg: string, meta?: object) => console.log(formatLog('info',  msg, context, meta)),
    warn:  (msg: string, meta?: object) => console.warn(formatLog('warn',  msg, context, meta)),
    error: (msg: string, meta?: object) => console.error(formatLog('error', msg, context, meta)),
    debug: (msg: string, meta?: object) => {
      if (process.env.NODE_ENV !== 'production')
        console.log(formatLog('debug', msg, context, meta));
    },
  };
}

export function decorateGlobalConsole(): void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  function parseAndFormat(args: any[], level: 'info' | 'warn' | 'error'): string {
    const rawMsg = args.map(arg => {
      if (arg instanceof Error) {
        return arg.stack || `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'object' && arg !== null) {
        try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
      }
      return String(arg);
    }).join(' ');

    let service = 'app';
    let cleanMsg = rawMsg;

    // Detect service tags like [API], [PostManagement], [Jobs], etc.
    const serviceTagMatch = rawMsg.match(/^\[([^\]]+)\]\s*(.*)/s);
    if (serviceTagMatch) {
      const parsedSvc = serviceTagMatch[1].trim();
      service = parsedSvc.toLowerCase().replace(/\s+/g, '-');
      cleanMsg = serviceTagMatch[2];
    } else if (rawMsg.startsWith('prisma:')) {
      service = 'prisma';
    }

    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    const style = getServiceStyle(service);
    const ls = LEVEL_STYLES[level] || LEVEL_STYLES.info;
    
    const timeStr = `${C.gray}${time}${C.reset}`;
    const levelStr = `${ls.color}${C.bold}${ls.icon}${ls.label}${C.reset}`;
    const badgeStr = `${style.bg}${style.fg} ${style.icon}${style.label} ${C.reset}`;
    const deltaStr = getDeltaTime();

    if (level === 'error' || cleanMsg.includes('prisma:error') || cleanMsg.includes('Error caught:') || cleanMsg.includes('\n    at ')) {
      return formatErrorBox(cleanMsg, service);
    }

    const msgStr = processMsgColors(cleanMsg, level);

    return `${timeStr} ${levelStr} [ ${badgeStr} ] ❯ ${msgStr} (${deltaStr})`;
  }

  console.log = (...args: any[]) => {
    if (args.length === 0) {
      originalLog();
      return;
    }
    if (typeof args[0] === 'string' && args[0].includes('\x1b[')) {
      originalLog(...args);
    } else {
      originalLog(parseAndFormat(args, 'info'));
    }
  };

  console.warn = (...args: any[]) => {
    if (args.length === 0) {
      originalWarn();
      return;
    }
    if (typeof args[0] === 'string' && args[0].includes('\x1b[')) {
      originalWarn(...args);
    } else {
      originalWarn(parseAndFormat(args, 'warn'));
    }
  };

  console.error = (...args: any[]) => {
    if (args.length === 0) {
      originalError();
      return;
    }
    if (typeof args[0] === 'string' && args[0].includes('\x1b[')) {
      originalError(...args);
    } else {
      originalError(parseAndFormat(args, 'error'));
    }
  };
}

// Automatically activate the global decorator upon import
decorateGlobalConsole();

