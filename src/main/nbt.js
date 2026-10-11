'use strict';
// Lettore NBT minimale (big-endian, Java Edition) per leggere level.dat.

const zlib = require('zlib');

function parseNbt(buf) {
  let data = buf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) data = zlib.gunzipSync(buf);
  else if (buf[0] === 0x78) data = zlib.inflateSync(buf);
  let o = 0;
  const u8 = () => data.readUInt8(o++);
  const i16 = () => { const v = data.readInt16BE(o); o += 2; return v; };
  const u16 = () => { const v = data.readUInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = data.readInt32BE(o); o += 4; return v; };
  const i64 = () => { const v = data.readBigInt64BE(o); o += 8; return v.toString(); };
  const f32 = () => { const v = data.readFloatBE(o); o += 4; return v; };
  const f64 = () => { const v = data.readDoubleBE(o); o += 8; return v; };
  const str = () => { const len = u16(); const s = data.toString('utf8', o, o + len); o += len; return s; };

  function payload(type) {
    switch (type) {
      case 1: { const v = data.readInt8(o); o += 1; return v; }
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: return f32();
      case 6: return f64();
      case 7: { const n = i32(); const v = data.subarray(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: {
        const t = u8(); const n = i32(); const arr = [];
        for (let i = 0; i < n; i++) arr.push(payload(t));
        return arr;
      }
      case 10: {
        const obj = {};
        for (;;) {
          const t = u8();
          if (t === 0) break;
          const name = str();
          obj[name] = payload(t);
        }
        return obj;
      }
      case 11: { const n = i32(); const arr = []; for (let i = 0; i < n; i++) arr.push(i32()); return arr; }
      case 12: { const n = i32(); const arr = []; for (let i = 0; i < n; i++) arr.push(i64()); return arr; }
      default: throw new Error('Tag NBT sconosciuto: ' + type);
    }
  }

  const rootType = u8();
  if (rootType !== 10) throw new Error('level.dat non valido');
  str();
  return payload(10);
}

const GAME_TYPES = ['survival', 'creative', 'adventure', 'spectator'];

/** Estrae le informazioni utili da un level.dat. */
function readLevelInfo(buf) {
  const root = parseNbt(buf);
  const d = root.Data || root;
  const seed = (d.WorldGenSettings && d.WorldGenSettings.seed) || d.RandomSeed || null;
  return {
    levelName: d.LevelName || null,
    version: (d.Version && d.Version.Name) || null,
    dataVersion: d.DataVersion || (d.Version && d.Version.Id) || null,
    lastPlayed: d.LastPlayed ? Number(d.LastPlayed) : null,
    gameMode: GAME_TYPES[d.GameType] || null,
    hardcore: !!d.hardcore,
    seed,
    modded: Array.isArray(d.ServerBrands) ? d.ServerBrands.filter((b) => b !== 'vanilla') : [],
  };
}

module.exports = { parseNbt, readLevelInfo };
