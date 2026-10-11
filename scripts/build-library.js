// Builds mylibrary/books.json (and caches covers) from the "Libros" Google Sheet.
// Usage: node scripts/build-library.js   (needs the `gws` CLI logged in)
// The sheet is the source of truth: edit it, run this, commit and push.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1hfzazWR82o5aBcCmZ8jaLOxUlXBO0LFslNgeT7YL9rc';
const OUT_DIR = path.join(__dirname, '..', 'mylibrary');
const COVERS = path.join(OUT_DIR, 'covers');

const PILLARS = { 'Amor': 'Love', 'Espiritualidad': 'Spirituality', 'Salud': 'Health', 'Conocimiento': 'Knowledge' };
const BLOCKS = {
  'Pareja y familia': 'Partner & family', 'Relaciones y comunicación': 'Relationships',
  'Fe y sentido': 'Faith & meaning', 'Carácter y hábitos': 'Character & habits',
  'Cuerpo': 'Body', 'Mente y cerebro': 'Mind & brain',
  'Negocio': 'Business', 'Humanidades': 'Humanities', 'Ciencia y tecnología': 'Science & tech', 'Cultura': 'Culture',
};
const CATEGORIES = {
  'Familia y paternidad': 'Family & parenting', 'Comunicación y conflicto': 'Communication & conflict',
  'Religión y fe': 'Religion & faith', 'Sentido y propósito': 'Meaning & purpose', 'Filosofía práctica': 'Practical philosophy',
  'Mentalidad y carácter': 'Mindset & character', 'Hábitos y productividad personal': 'Habits & productivity',
  'Entrenamiento y deporte': 'Training & sport', 'Nutrición': 'Nutrition', 'Sueño y recuperación': 'Sleep & recovery',
  'Longevidad y medicina': 'Longevity & medicine', 'Cerebro y neurociencia': 'Brain & neuroscience', 'Salud mental': 'Mental health',
  'Emprendimiento': 'Entrepreneurship', 'Estrategia': 'Strategy', 'Growth y ventas': 'Growth & sales', 'Producto': 'Product',
  'Management y liderazgo': 'Management & leadership', 'Finanzas e inversión': 'Finance & investing',
  'Historia': 'History', 'Política y geopolítica': 'Politics & geopolitics', 'Economía': 'Economics', 'Filosofía': 'Philosophy',
  'Sociología y antropología': 'Sociology & anthropology', 'Psicología y comportamiento': 'Psychology & behaviour',
  'Pensamiento y decisión': 'Thinking & decisions', 'Ciencia': 'Science', 'Matemáticas': 'Mathematics',
  'Tecnología e IA': 'Technology & AI', 'Ingeniería': 'Engineering', 'Literatura': 'Literature', 'Arte': 'Art',
  'Cine': 'Film', 'Ajedrez': 'Chess', 'Escritura y comunicación': 'Writing & communication',
};
const PLANS = {
  'Humanidades - The Long Conversation': 'Humanities', 'Business - Founder Action Mode': 'Business',
  'Mentalidad - Amor Fati': 'Mindset', 'Historia de España - Plus Ultra': 'History of Spain',
};
const STATUS = { 'Leído': 'read', 'Leyendo': 'reading' };

const tr = (map, v, kind) => {
  if (!v) return '';
  if (!map[v]) console.warn(`! ${kind} sin traducir: "${v}"`);
  return map[v] || v;
};
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function readSheet() {
  const params = JSON.stringify({ spreadsheetId: SHEET_ID, range: 'List!A1:N1000' }).replace(/"/g, '\\"');
  const raw = execSync(`gws sheets spreadsheets values get --params "${params}" --format json`, { encoding: 'utf8', maxBuffer: 1e8 });
  return JSON.parse(raw.slice(raw.indexOf('{'))).values;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 1500 ? buf : null; // Amazon answers a 43-byte gif when there is no cover
  } catch { return null; }
}

async function findCover(book) {
  const file = path.join(COVERS, book.id + '.jpg');
  if (fs.existsSync(file)) return true;
  const tries = [];
  if (book.isbn) {
    tries.push(`https://images-na.ssl-images-amazon.com/images/P/${book.isbn}.01.MZZZZZZZ.jpg`);
  }
  for (const url of tries) {
    const buf = await fetchImage(url);
    if (buf) { fs.writeFileSync(file, buf); return true; }
  }
  // Fallback: Open Library search by title + author (cover ids are not rate limited)
  try {
    const q = new URLSearchParams({ title: book.title, author: book.author, limit: '1', fields: 'cover_i' });
    const res = await fetch(`https://openlibrary.org/search.json?${q}`, { headers: { 'User-Agent': 'borjaanadon.com library (hi@borjaanadon.com)' } });
    const id = res.ok && (await res.json()).docs?.[0]?.cover_i;
    if (id) {
      const buf = await fetchImage(`https://covers.openlibrary.org/b/id/${id}-M.jpg`);
      if (buf) { fs.writeFileSync(file, buf); return true; }
    }
  } catch {}
  return false;
}

async function main() {
  const [, ...rows] = readSheet();
  const seen = new Set();
  const books = rows.filter(r => r[0] && r[0].trim()).map(r => {
    // A Título · B Autor · C Link · D Comprado? · E Estado · F Pilar · G Bloque · H Categoría · I Plan · J Orden · K Año leído · L Nota · M Opinión · N Aprendizajes
    const [title, author, link, , estado, pillar, block, category, plan, , year, rating, opinion, learnings] = Array.from({ length: 14 }, (_, i) => (r[i] || '').trim());
    const isbn = (link.match(/\/dp\/([0-9X]{10})/i) || [])[1] || '';
    let id = slug(title) || 'book';
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return {
      id, title, author, isbn,
      url: isbn ? `https://www.amazon.es/dp/${isbn}` : link.split('?')[0],
      pillar: tr(PILLARS, pillar, 'Pilar'), block: tr(BLOCKS, block, 'Bloque'), category: tr(CATEGORIES, category, 'Categoría'),
      plan: PLANS[plan] || '',
      status: STATUS[estado] || 'toread',
      year: year || '', rating: Number(rating) || 0,
      opinion, learnings: learnings ? learnings.split(/\n+/).map(s => s.replace(/^[-•*]\s*/, '')).filter(Boolean) : [],
    };
  });

  fs.mkdirSync(COVERS, { recursive: true });
  let done = 0, found = 0;
  const queue = [...books];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const b = queue.shift();
      b.cover = (await findCover(b)) ? `covers/${b.id}.jpg` : '';
      if (b.cover) found++;
      if (++done % 50 === 0) console.log(`  portadas ${done}/${books.length}`);
    }
  }));

  const out = { updated: new Date().toISOString().slice(0, 10), books };
  fs.writeFileSync(path.join(OUT_DIR, 'books.json'), JSON.stringify(out));
  const by = s => books.filter(b => b.status === s).length;
  console.log(`OK: ${books.length} libros (${by('read')} leídos, ${by('reading')} leyendo, ${by('toread')} por leer), ${found} con portada`);
  const missing = books.filter(b => !b.cover).map(b => b.title);
  if (missing.length) console.log('Sin portada:', missing.join(' | '));
}

main();
