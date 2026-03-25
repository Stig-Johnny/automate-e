import http from 'node:http';

const quotes = [
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: 'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.', author: 'Martin Fowler' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'Code is like humor. When you have to explain it, it\'s bad.', author: 'Cory House' },
  { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Harold Abelson' },
];

const facts = [
  { category: 'tech', fact: 'The first computer bug was an actual bug — a moth found in a Harvard Mark II computer in 1947.' },
  { category: 'tech', fact: 'The first 1GB hard drive, announced in 1980, weighed about 250 kg and cost $40,000.' },
  { category: 'tech', fact: 'The QWERTY keyboard layout was designed in 1873 to prevent typewriter jams.' },
  { category: 'space', fact: 'A day on Venus is longer than a year on Venus.' },
  { category: 'space', fact: 'Neutron stars are so dense that a teaspoon would weigh about 6 billion tonnes.' },
  { category: 'space', fact: 'There are more stars in the universe than grains of sand on all of Earth\'s beaches.' },
  { category: 'nature', fact: 'Honey never spoils. Archaeologists have found 3000-year-old honey in Egyptian tombs that was still edible.' },
  { category: 'nature', fact: 'Octopuses have three hearts and blue blood.' },
  { category: 'nature', fact: 'A group of flamingos is called a "flamboyance".' },
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/quotes/random') {
    json(res, randomItem(quotes));
  } else if (req.method === 'GET' && url.pathname === '/quotes') {
    const author = url.searchParams.get('author');
    const filtered = author
      ? quotes.filter(q => q.author.toLowerCase().includes(author.toLowerCase()))
      : quotes;
    json(res, filtered);
  } else if (req.method === 'GET' && url.pathname === '/facts/random') {
    const category = url.searchParams.get('category')?.toLowerCase().trim();
    const pool = category
      ? facts.filter(f => f.category === category)
      : facts;
    if (!pool.length) return json(res, { error: 'No facts for that category. Valid categories: tech, space, nature' }, 404);
  } else if (req.method === 'GET' && url.pathname === '/facts') {
    const category = url.searchParams.get('category')?.toLowerCase().trim();
    const filtered = category
      ? facts.filter(f => f.category === category)
      : facts;
    json(res, filtered);
  } else if (req.method === 'GET' && url.pathname === '/facts/categories') {
    json(res, [...new Set(facts.map(f => f.category))]);
  } else if (req.method === 'GET' && url.pathname === '/health') {
    json(res, { status: 'ok' });
  } else {
    json(res, { error: 'Not found' }, 404);
  }
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`Example-E API listening on port ${port}`));
