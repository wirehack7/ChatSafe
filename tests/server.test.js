const request = require('supertest');
const { app, chats, sanitize, toChatId } = require('../server');

afterEach(() => {
  chats.clear();
});

describe('GET /health', () => {
  it('returns 200 with status ok and room count', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.rooms).toBe('number');
  });

  it('reflects current room count', async () => {
    chats.set('testroom', { name: 'Test', locked: false, messages: [], chatters: new Map(), createdAt: Date.now() });
    const res = await request(app).get('/health');
    expect(res.body.rooms).toBe(1);
  });
});

describe('GET /new/:chatName', () => {
  it('creates a new chat and returns redirect id', async () => {
    const res = await request(app).get('/new/MyCoolChat');
    expect(res.status).toBe(200);
    expect(res.body.redirect).toBe('MyCoolChat');
    expect(chats.has('MyCoolChat')).toBe(true);
  });

  it('converts special characters to underscores', async () => {
    const res = await request(app).get('/new/Hello%20World');
    expect(res.status).toBe(200);
    expect(res.body.redirect).toBe('Hello_World');
  });

  it('returns 409 if chat name is already in use', async () => {
    await request(app).get('/new/duplicate');
    const res = await request(app).get('/new/duplicate');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  it('returns 400 when chat name is only stripped characters', async () => {
    // %3C%3E = "<>" which sanitize strips completely → empty chatId → 400
    const res = await request(app).get('/new/%3C%3E');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe('GET /:chatId', () => {
  it('serves chat.html for existing room', async () => {
    chats.set('existingroom', { name: 'Existing', locked: false, messages: [], chatters: new Map(), createdAt: Date.now() });
    const res = await request(app).get('/existingroom');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('redirects to / for non-existing room', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('sanitize()', () => {
  it('removes HTML special characters but keeps parentheses', () => {
    // sanitize strips: < > " ' `
    expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  it('trims whitespace', () => {
    expect(sanitize('  hello  ')).toBe('hello');
  });

  it('respects maxLen', () => {
    expect(sanitize('a'.repeat(200), 10)).toBe('a'.repeat(10));
  });

  it('returns empty string for non-string input', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(42)).toBe('');
    expect(sanitize(undefined)).toBe('');
  });
});

describe('toChatId()', () => {
  it('replaces spaces with underscores', () => {
    expect(toChatId('Hello World')).toBe('Hello_World');
  });

  it('removes special characters', () => {
    expect(toChatId('Test!@#Chat')).toBe('Test___Chat');
  });

  it('allows alphanumeric, dash, underscore', () => {
    expect(toChatId('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('truncates to 50 characters', () => {
    expect(toChatId('a'.repeat(60))).toHaveLength(50);
  });
});
