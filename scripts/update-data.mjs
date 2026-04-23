import { writeFile } from "node:fs/promises";

const sourceUrl =
  "https://www.city.sabae.fukui.jp/kurashi_tetsuduki/doro_kasen_koen/koen/nishiyama/Koen0120260413.html";
const outputPath = new URL("../docs/flowering-data.js", import.meta.url);

const placeCoordinates = [
  { test: /おまつり広場|お祭り広場/, x: 58, y: 43 },
  { test: /エントランス広場/, x: 45, y: 60 },
  { test: /道の駅西山公園/, x: 35, y: 20 },
  { test: /道の駅階段広場/, x: 30, y: 50 }
];

function normalizeText(text) {
  return text.replace(/\s+/g, "").replace(/お祭り/g, "おまつり").replace(/附近/g, "付近");
}

function toAbsoluteUrl(maybeRelative) {
  try {
    return new URL(maybeRelative, sourceUrl).toString();
  } catch {
    return maybeRelative;
  }
}

function detectCoords(place) {
  const normalized = normalizeText(place);
  const found = placeCoordinates.find((item) => item.test.test(normalized));
  if (found) {
    return { x: found.x, y: found.y };
  }

  return { x: 50, y: 50 };
}

function parseDateFromMeta(html) {
  const match = html.match(/最終更新日[:：]?\s*([0-9０-９]+年\s*[0-9０-９]+月\s*[0-9０-９]+日)/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function decodeHtmlFromBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const utf8Text = new TextDecoder("utf-8").decode(bytes);
  if (utf8Text.includes("西山公園つつじ開花情報") || utf8Text.includes("ヒラドツツジ")) {
    return utf8Text;
  }

  const shiftJisText = new TextDecoder("shift_jis").decode(bytes);
  return shiftJisText;
}

function parseEntries(html) {
  const entries = [];
  const tokenRegex =
    /<h3[^>]*>([\s\S]*?)<\/h3>|<p>\s*(満開|[0-9０-９]+分咲き|咲き始め|見頃|散り始め)\s*<\/p>|<p[^>]*class="img-left"[^>]*>[\s\S]*?<img[^>]+src="([^"]*\.images\/P\d+\.jpg)"[^>]*>[\s\S]*?場所\s*([^<\r\n]+?)(?=\s*撮影|<|$)(?:\s*撮影\s*([0-9０-９]+月[0-9０-９]+日))?[\s\S]*?<\/p>/gi;

  let currentSpecies = "";
  let currentBloom = "";
  let token;

  while ((token = tokenRegex.exec(html)) !== null) {
    const h3Raw = token[1];
    const bloom = token[2];
    const imageUrl = token[3];
    const place = token[4];
    const photoDate = token[5];

    if (h3Raw) {
      const heading = h3Raw.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
      if (heading.includes("ヒラドツツジ")) {
        currentSpecies = "ヒラドツツジ";
      } else if (heading.includes("クルメツツジ")) {
        currentSpecies = "クルメツツジ";
      }
      continue;
    }

    if (bloom) {
      currentBloom = bloom;
      continue;
    }

    if (!imageUrl || !place) {
      continue;
    }

    entries.push({
      species: currentSpecies,
      bloom: currentBloom,
      place: place.trim(),
      date: photoDate ? `${photoDate.trim()}撮影` : "",
      photo: toAbsoluteUrl(imageUrl.trim())
    });
  }

  return entries;
}

function groupByPlace(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    if (!entry.place) {
      continue;
    }

    const key = normalizeText(entry.place);
    if (!grouped.has(key)) {
      const coords = detectCoords(entry.place);
      grouped.set(key, {
        id: `spot-${grouped.size + 1}`,
        place: entry.place,
        species: entry.species,
        bloom: entry.bloom,
        date: entry.date,
        x: coords.x,
        y: coords.y,
        photos: []
      });
    }

    const point = grouped.get(key);
    if (entry.species && point.species !== entry.species) {
      point.species = `${point.species} / ${entry.species}`;
    }
    if (entry.bloom && !point.bloom) {
      point.bloom = entry.bloom;
    }
    if (entry.date && !point.date) {
      point.date = entry.date;
    }
    point.photos.push(entry.photo);
  }

  return [...grouped.values()];
}

async function main() {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch source page: ${response.status}`);
  }

  const htmlBuffer = await response.arrayBuffer();
  const html = decodeHtmlFromBuffer(htmlBuffer);
  const entries = parseEntries(html);
  const points = groupByPlace(entries);

  if (!points.length) {
    throw new Error("No flowering points were parsed from source HTML.");
  }

  const data = {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    pageUpdatedAt: parseDateFromMeta(html),
    points
  };

  const jsPayload = `window.FLOWERING_DATA = ${JSON.stringify(data, null, 2)};\n`;
  await writeFile(outputPath, jsPayload, "utf8");
  console.log(`Updated flowering-data.js with ${points.length} spots.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
