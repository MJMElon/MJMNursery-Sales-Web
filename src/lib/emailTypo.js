// Email domain typo detection — ported unchanged from the original
// auth.html inline script.

const KNOWN_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.com.my', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'mail.com', 'protonmail.com', 'zoho.com', 'ymail.com', 'googlemail.com', '163.com', 'qq.com', 'naver.com', 'hanmail.net', 'daum.net'];

const DOMAIN_TYPO_MAP = {
  'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmailcom': 'gmail.com', 'gmail.comm': 'gmail.com',
  'homail.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmil.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.om': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotamil.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com', 'hotmail.cm': 'hotmail.com', 'hotmails.com': 'hotmail.com', 'hotmali.com': 'hotmail.com', 'hotmaol.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.om': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.com.my': 'yahoo.com.my', 'yaho.com.my': 'yahoo.com.my',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlool.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outllok.com': 'outlook.com', 'outlokk.com': 'outlook.com',
  'iclould.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com', 'iclud.com': 'icloud.com',
  'liv.com': 'live.com', 'live.co': 'live.com', 'live.om': 'live.com', 'protonmal.com': 'protonmail.com',
};

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : Math.min(d[i - 1][j - 1], d[i][j - 1], d[i - 1][j]) + 1;
    }
  }
  return d[m][n];
}

export function checkEmailTypo(email) {
  if (!email || !email.includes('@')) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  if (DOMAIN_TYPO_MAP[domain]) return parts[0] + '@' + DOMAIN_TYPO_MAP[domain];
  if (KNOWN_DOMAINS.indexOf(domain) === -1) {
    for (let i = 0; i < KNOWN_DOMAINS.length; i++) {
      if (Math.abs(domain.length - KNOWN_DOMAINS[i].length) <= 1 && levenshtein(domain, KNOWN_DOMAINS[i]) === 1) {
        return parts[0] + '@' + KNOWN_DOMAINS[i];
      }
    }
  }
  return null;
}
