/* Parsing of issuer-formatted values: amounts, dates, and merchant names. Pure functions. */
(function (SA) {
  'use strict';

  // "$1,234.56", "(12.00)", "-12", "12.00-", "12.00 CR" -> number (CR/parentheses/trailing minus = negative).
  function parseAmount(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/\s*CR$/i.test(s)) { neg = !neg; s = s.replace(/\s*CR$/i, ''); }
    s = s.replace(/\s*DR$/i, '');
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    s = s.replace(/[$€£\s,]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return neg ? -n : n;
  }

  const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function monthNum(name) { return MONTH_NAMES[name.slice(0, 3).toLowerCase()]; }

  function iso(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null; // e.g. Feb 30
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // format: 'MDY' | 'DMY' | 'YMD'. Returns 'YYYY-MM-DD' or null.
  function parseDate(raw, format) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (m) return format === 'DMY' ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
    m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s,-]+(\d{2,4})$/); // 03 Sep 2026
    if (m && monthNum(m[2])) return iso(+m[3], monthNum(m[2]), +m[1]);
    m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // Sep 3, 2026
    if (m && monthNum(m[1])) return iso(+m[3], monthNum(m[1]), +m[2]);
    if (/^\d{8}$/.test(s)) return iso(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); // 20260903
    return null;
  }

  // Pick MDY vs DMY for slash dates: any first component > 12 means day-first.
  function detectDateFormat(values) {
    let sawSlash = false;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
      if (!m) continue;
      sawSlash = true;
      if (+m[1] > 12) return 'DMY';
      if (+m[2] > 12) return 'MDY';
    }
    return sawSlash ? 'MDY' : 'YMD';
  }

  function looksLikeDate(v) { return parseDate(v, 'MDY') != null; }
  function looksLikeAmount(v) { return /\d/.test(String(v || '')) && parseAmount(v) != null; }

  // Well-known merchants whose raw descriptions vary a lot. First match wins.
  const ALIASES = [
    [/^AMAZON PRIME|^PRIME VIDEO/, 'Amazon Prime'],
    [/^AMAZON DIGI|^AMZN DIGITAL/, 'Amazon Digital'],
    [/^AMAZON WEB SERVICES|^AWS\b/, 'Amazon Web Services'],
    [/^(AMZN|AMAZON)\b/, 'Amazon'],
    [/^WHOLEFDS|^WHOLE FOODS|^WFM\b/, 'Whole Foods'],
    [/^UBER\s*\*?\s*EATS/, 'Uber Eats'],
    [/^UBER\b/, 'Uber'],
    [/^LYFT\b/, 'Lyft'],
    [/^DOORDASH|^DD \*DOORDASH/, 'DoorDash'],
    [/^INSTACART/, 'Instacart'],
    [/^NETFLIX/, 'Netflix'],
    [/^SPOTIFY/, 'Spotify'],
    [/^HULU/, 'Hulu'],
    [/^APPLE\.COM|^APPLE STORE|^APL\*/, 'Apple'],
    [/^GOOGLE\s*\*?\s*YOUTUBE|^YOUTUBE/, 'YouTube'],
    [/^GOOGLE/, 'Google'],
    [/^TRADER JOE/, "Trader Joe's"],
    [/^COSTCO GAS/, 'Costco Gas'],
    [/^COSTCO|^WWW COSTCO/, 'Costco'],
    [/^SAMS ?CLUB|^SAM'S CLUB/, "Sam's Club"],
    [/^CHICK[- ]?FIL[- ]?A/, 'Chick-fil-A'],
    [/^DD\/BR\b|^DUNKIN/, "Dunkin'"],
    [/^CIRCLE ?K\b/, 'Circle K'],
    [/^TJ ?MAXX/, 'TJ Maxx'],
    [/^ETSY/, 'Etsy'],
    [/^GIANT[- ]EAGLE/, 'Giant Eagle'],
    [/^CRATE ?(AND|&)? ?BARREL/, 'Crate & Barrel'],
    [/^TARGET\b/, 'Target'],
    [/^(WAL-?MART|WM SUPERCENTER)/, 'Walmart'],
    [/^STARBUCKS/, 'Starbucks'],
    [/^SHELL\b/, 'Shell'],
    [/^CHEVRON/, 'Chevron'],
    [/^CVS/, 'CVS'],
    [/^WALGREENS/, 'Walgreens'],
    [/^SAFEWAY/, 'Safeway'],
    [/^KROGER/, 'Kroger'],
    [/^MCDONALD/, "McDonald's"],
    [/^CHIPOTLE/, 'Chipotle'],
    [/^HOME DEPOT|^THE HOME DEPOT/, 'Home Depot'],
    [/^LOWE'?S/, "Lowe's"],
    [/^PAYPAL \*?\s*$/, 'PayPal'],
  ];

  // Payment-processor prefixes that precede the real merchant name ("SQ *BLUE BOTTLE").
  const PROCESSOR_PREFIX = /^(SQ|SQU|TST|SP|PP|PY|IN|BT|CKE|LS|POS|FS|PAR|GRUBHUB|PAYPAL|PAYPAL INST XFER|EB|WPY|ZLR|DRI|CLR|HLU|MSFT|NYX|OTTER|TOAST)\s?\*\s?/;
  // Prefixes some issuers write without a star: Apple Pay (Amex "AplPay APPLE.COM/BILL") and Shopify ("SP GIBSON").
  const BARE_PREFIX = /^(APLPAY|APPLE PAY|SP)\s+/;

  const US_STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR').split(' '));

  // Words that mark a multi-word city name ("SAN JOSE", "NORTH WALES", "MAPLE HTS", "PELICAN ISLAN").
  const CITY_FIRST = new Set(('SAN SANTA LOS LAS NEW SAINT ST FORT FT NORTH SOUTH EAST WEST PORT MOUNT MT LAKE PALM EL ' +
    'GRAND CEDAR BATON SALT COLORADO CORPUS SIOUX HOT OVERLAND OKLAHOMA JERSEY KANSAS CAPE DES').split(' '));
  const CITY_LAST = new Set(('CITY HTS HEIGHTS HEIGHT HEIG BEACH SPRINGS SPGS FALLS PARK HILLS VALLEY ISLAND ISLAN VILLAGE ' +
    'TWP TOWNSHIP CENTER JUNCTION LAKES POINT GROVE RAPIDS BLUFFS CREEK HARBOR VIEW').split(' '));

  // Card networks send "NAME  CITY  ST" with the city cut to 13 characters. Issuers that collapse the padding
  // (Citi: "EXAMPLE TAVERN DAYTON OH") leave no clean boundary, so drop the state plus the longest trailing city
  // of at most 13 characters that leaves a two-word name, or a one-word name when the city is recognizably multi-word.
  function stripLocation(s) {
    const toks = s.split(' ');
    if (toks.length < 3 || !US_STATES.has(toks[toks.length - 1])) return s;
    const rest = toks.slice(0, -1);
    let cut = 1;
    for (let k = 2; k < rest.length; k++) {
      const city = rest.slice(-k);
      if (city.join(' ').length > 13) break;
      const cityLike = CITY_FIRST.has(city[0]) || CITY_LAST.has(city[city.length - 1]);
      if (rest.length - k >= 2 || cityLike) cut = k;
    }
    return rest.slice(0, rest.length - cut).join(' ');
  }

  const SMALL_WORDS = new Set(['and', 'of', 'the', 'at', 'for', 'on', 'in']);
  const KEEP_UPPER = new Set(['CVS', 'AT&T', 'USA', 'US', 'UPS', 'USPS', 'IKEA', 'BP', 'H&M', 'TJ', 'KFC', 'LLC', 'DMV', 'ATM', 'NYC', 'LA', 'SF', 'HBO', 'AAA', 'REI', 'BBQ', 'TV']);

  function titleCase(s) {
    return s.split(' ').map((w, i) => {
      if (KEEP_UPPER.has(w)) return w;
      const lw = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lw)) return lw;
      // Ampersand acronyms (PG&E, AT&T) stay upper-case, including inside "PG&E/EZ-PAY".
      return w.split('/').map((seg) => /^[A-Z]{1,3}&[A-Z]{1,3}$/.test(seg) ? seg
        : seg.toLowerCase().replace(/(^|[-(])([a-z])/g, (m, p, c) => p + c.toUpperCase())).join('/');
    }).join(' ');
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  // Some issuers (Chase) HTML-escape their CSVs: "RIVER &amp; RAIL".
  function decodeEntities(s) {
    return String(s).replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) => (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : ENTITIES[e]));
  }

  // "X*Y": a short code before the star is a processor ("TM *TICKETMASTER", "PMT*STATE BUREAU"),
  // while a reference code after it means the name comes first ("AIRBNB * HM2EXAMPLE", "ETSY.COM*SHOPNAME").
  function splitStar(s) {
    const m = s.match(/^([^*]+?)\s*\*\s*(.*)$/);
    if (!m) return s;
    const before = m[1].trim(), after = m[2].trim();
    const firstAfter = after.split(/\s+/)[0];
    const afterIsRef = !after || (/\d/.test(firstAfter) && /^[A-Z0-9]+$/.test(firstAfter));
    return !afterIsRef && /^[A-Z]{2,4}$/.test(before) && /[A-Z]{3}/.test(after) ? after : before;
  }

  // True when most descriptions end in a state code ("... DAYTON OH"), i.e. the issuer appends city/state.
  // Decided per file so issuers that truncate names (Chase: "GOLDEN YOLK EGG CA[FE]") aren't mangled.
  function hasLocations(descs) {
    const vals = descs.filter(Boolean);
    const hits = vals.filter((d) => US_STATES.has(String(d).trim().toUpperCase().replace(/(\s+NULL)?\s+X{4,}\d*$/, '').split(/\s+/).pop())).length;
    return vals.length > 0 && hits / vals.length >= 0.5;
  }

  /** opts.location: descriptions end with "CITY ST" (see hasLocations). */
  function cleanMerchant(desc, opts) {
    // Citi sometimes appends a masked card number: "... HARTFORD CT null XXXXXXXXXXXX0000".
    let s = decodeEntities(String(desc || '')).toUpperCase().replace(/(\s+NULL)?\s+X{4,}\d*\s*$/, '').replace(/\s+$/, '');
    if (!s) return 'Unknown';
    for (const [re, name] of ALIASES) if (re.test(s.trim())) return name;
    // Issuers pad merchant / city / state with runs of spaces; the first chunk is the merchant.
    s = s.split(/\s{2,}|\t/)[0].trim().replace(/^WWW[. ]/, '');
    for (let i = 0; i < 2; i++) s = s.replace(PROCESSOR_PREFIX, '').replace(BARE_PREFIX, '');
    for (const [re, name] of ALIASES) if (re.test(s)) return name;
    s = splitStar(s).replace(/\s+/g, ' ');
    if (opts && opts.location) s = stripLocation(s);
    for (const [re, name] of ALIASES) if (re.test(s)) return name;
    // Truncate at the first store-number / reference token (#123, 3+ digits, long alnum codes).
    // "BP#1234567MAIN" -> "BP #1234567MAIN" so the store number splits off. Leading numbers are
    // only dropped when they look like store numbers (4+ digits), so "365 MARKET" keeps its name.
    const tokens = s.replace(/(\S)#/g, '$1 #').split(/\s+/);
    const kept = [];
    for (const tok of tokens) {
      const isRef = /^#/.test(tok) || (kept.length ? /\d{3,}/ : /\d{4,}/).test(tok) || /^[A-Z0-9]{10,}$/.test(tok) && /\d/.test(tok);
      if (isRef && kept.length) break;
      if (!isRef) kept.push(tok);
    }
    const name = kept.join(' ').replace(/[\s.,*#(@&/-]+$/, '').replace(/^[\s.,*#-]+/, '').trim();
    return titleCase(name || s) || 'Unknown';
  }

  SA.normalize = { decodeEntities, parseAmount, parseDate, detectDateFormat, looksLikeDate, looksLikeAmount, hasLocations, cleanMerchant, titleCase };
})(window.SA = window.SA || {});
