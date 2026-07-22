const imageCache = new Map();

async function getDDGImage(query) {
  if (imageCache.has(query)) return imageCache.get(query);

  try {
    const initRes = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const initText = await initRes.text();
    const vqdMatch = initText.match(/vqd=[\"']?([^&\"'\s]+)/) || initText.match(/vqd=\"([^\"]+)\"/);
    if (!vqdMatch) return null;

    const vqd = vqdMatch[1];
    const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const imgData = await imgRes.json();
    if (imgData.results && imgData.results.length > 0) {
      const imgUrl = imgData.results[0].image;
      imageCache.set(query, imgUrl);
      return imgUrl;
    }
  } catch (err) {
    console.error('DDG Image fetch error:', err);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query.q || req.query.query || '';
  if (!query) {
    return res.status(400).json({ error: 'Missing search query q' });
  }

  const imageUrl = await getDDGImage(query);
  if (imageUrl) {
    return res.status(200).json({ ok: true, img: imageUrl });
  } else {
    return res.status(404).json({ ok: false, error: 'No image found' });
  }
}
