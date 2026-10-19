/* ==========================================================================
   Mis Aventuras RD — lector y escritor ZIP mínimo, sin dependencias.
   Soporta archivos guardados (método 0) y, al leer, también deflate (método 8)
   cuando el navegador tiene DecompressionStream. No usa ZIP64 ni cifrado.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SimpleZip = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_ENTRIES = 10000;
  var MAX_TOTAL = 1500 * 1024 * 1024; // 1,5 GB descomprimidos
  var MAX_ZIP32 = 0xFFFFFFFF;

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }());

  function crc32(bytes) {
    var value = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      value = CRC_TABLE[(value ^ bytes[i]) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ 0xFFFFFFFF) >>> 0;
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value);
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value && typeof value.buffer === "object" && typeof value.byteLength === "number") {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    }
    throw new TypeError("Contenido de archivo no válido para el ZIP");
  }

  function dosDateTime(input) {
    var date = input instanceof Date && !isNaN(input.getTime()) ? input : new Date();
    var year = Math.min(2107, Math.max(1980, date.getFullYear()));
    var month = Math.min(12, Math.max(1, date.getMonth() + 1));
    var day = Math.min(31, Math.max(1, date.getDate()));
    var time = ((date.getHours() & 0x1F) << 11) |
      ((date.getMinutes() & 0x3F) << 5) |
      ((date.getSeconds() & 0x3F) >> 1);
    var dateValue = ((year - 1980) << 9) | (month << 5) | day;
    return { time: time & 0xFFFF, date: dateValue & 0xFFFF };
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value & 0xFFFF, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  /**
   * Crea un ZIP con los archivos indicados.
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|string}>} entries
   * @param {{date?:Date, onProgress?:Function}} options
   * @returns {Promise<Blob>}
   */
  async function create(entries, options) {
    var opts = options || {};
    var date = opts.date instanceof Date ? opts.date : new Date();
    var dos = dosDateTime(date);
    var list = [];

    if (!Array.isArray(entries) || !entries.length) {
      throw new Error("No hay archivos para crear el ZIP");
    }
    if (entries.length > MAX_ENTRIES) {
      throw new Error("La copia tiene demasiados archivos");
    }

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i] || {};
      var name = String(entry.name == null ? "" : entry.name).replace(/\\/g, "/").replace(/^\.\/+/, "");
      if (!name || name.charAt(0) === "/" || name.indexOf("../") >= 0 || name === "..") {
        throw new Error("Nombre de archivo no válido en el ZIP");
      }
      var nameBytes = new TextEncoder().encode(name);
      if (!nameBytes.length || nameBytes.length > 0xFFFF) {
        throw new Error("Nombre de archivo demasiado largo");
      }
      var data = toBytes(entry.data);
      list.push({ name: name, nameBytes: nameBytes, data: data, crc: crc32(data) });
    }

    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var centralSize = 0;
    var total = 0;

    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      total += item.data.length;
      if (total > MAX_ZIP32) {
        throw new Error("La copia es demasiado grande para un ZIP normal");
      }

      var local = new Uint8Array(30 + item.nameBytes.length);
      var localView = new DataView(local.buffer);
      writeU32(localView, 0, 0x04034B50);
      writeU16(localView, 4, 20);       // versión necesaria
      writeU16(localView, 6, 0x0800);   // nombres en UTF-8
      writeU16(localView, 8, 0);        // método: guardado
      writeU16(localView, 10, dos.time);
      writeU16(localView, 12, dos.date);
      writeU32(localView, 14, item.crc);
      writeU32(localView, 18, item.data.length);
      writeU32(localView, 22, item.data.length);
      writeU16(localView, 26, item.nameBytes.length);
      writeU16(localView, 28, 0);
      local.set(item.nameBytes, 30);

      localParts.push(local, item.data);

      var central = new Uint8Array(46 + item.nameBytes.length);
      var centralView = new DataView(central.buffer);
      writeU32(centralView, 0, 0x02014B50);
      writeU16(centralView, 4, 20);      // versión que lo creó
      writeU16(centralView, 6, 20);      // versión necesaria
      writeU16(centralView, 8, 0x0800);  // UTF-8
      writeU16(centralView, 10, 0);      // método: guardado
      writeU16(centralView, 12, dos.time);
      writeU16(centralView, 14, dos.date);
      writeU32(centralView, 16, item.crc);
      writeU32(centralView, 20, item.data.length);
      writeU32(centralView, 24, item.data.length);
      writeU16(centralView, 28, item.nameBytes.length);
      writeU16(centralView, 30, 0);      // extra
      writeU16(centralView, 32, 0);      // comentario
      writeU16(centralView, 34, 0);      // disco
      writeU16(centralView, 36, 0);      // atributos internos
      writeU32(centralView, 38, 0);      // atributos externos
      writeU32(centralView, 42, offset);
      central.set(item.nameBytes, 46);

      centralParts.push(central);
      centralSize += central.length;
      offset += local.length + item.data.length;

      if (typeof opts.onProgress === "function") {
        await opts.onProgress(j + 1, list.length, item.name);
      }
    }

    var eocd = new Uint8Array(22);
    var eocdView = new DataView(eocd.buffer);
    writeU32(eocdView, 0, 0x06054B50);
    writeU16(eocdView, 4, 0);
    writeU16(eocdView, 6, 0);
    writeU16(eocdView, 8, list.length);
    writeU16(eocdView, 10, list.length);
    writeU32(eocdView, 12, centralSize);
    writeU32(eocdView, 16, offset);
    writeU16(eocdView, 20, 0);

    var parts = localParts.concat(centralParts);
    parts.push(eocd);
    return new Blob(parts, { type: "application/zip" });
  }

  function findEndOfCentralDirectory(bytes, view) {
    var minimum = Math.max(0, bytes.length - 22 - 0xFFFF);
    for (var i = bytes.length - 22; i >= minimum; i--) {
      if (view.getUint32(i, true) !== 0x06054B50) continue;
      var commentLength = view.getUint16(i + 20, true);
      if (i + 22 + commentLength <= bytes.length) return i;
    }
    throw new Error("El archivo no es un ZIP válido");
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function" || typeof Blob !== "function") {
      throw new Error("Este navegador no puede abrir ZIP comprimidos. Usa una copia creada por la app.");
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Lee un ZIP y devuelve sus archivos.
   * @param {ArrayBuffer|Uint8Array} input
   * @param {{onProgress?:Function}} options
   * @returns {Promise<{entries:Map<string,{name:string,data:Uint8Array,size:number}>, names:string[]}>}
   */
  async function read(input, options) {
    var opts = options || {};
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 22) throw new Error("El archivo ZIP está vacío o incompleto");
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = findEndOfCentralDirectory(bytes, view);
    var count = view.getUint16(eocd + 10, true);
    var centralSize = view.getUint32(eocd + 12, true);
    var centralOffset = view.getUint32(eocd + 16, true);

    if (!count) throw new Error("El ZIP no contiene archivos");
    if (count > MAX_ENTRIES) throw new Error("El ZIP contiene demasiados archivos");
    if (centralOffset + centralSize > bytes.length) throw new Error("El ZIP está dañado");

    var position = centralOffset;
    var entries = new Map();
    var names = [];
    var declaredTotal = 0;

    for (var i = 0; i < count; i++) {
      if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014B50) {
        throw new Error("El ZIP está dañado");
      }
      var flags = view.getUint16(position + 8, true);
      var method = view.getUint16(position + 10, true);
      var expectedCrc = view.getUint32(position + 16, true);
      var compressedSize = view.getUint32(position + 20, true);
      var uncompressedSize = view.getUint32(position + 24, true);
      var nameLength = view.getUint16(position + 28, true);
      var extraLength = view.getUint16(position + 30, true);
      var commentLength = view.getUint16(position + 32, true);
      var localOffset = view.getUint32(position + 42, true);
      var rawName = bytes.subarray(position + 46, position + 46 + nameLength);
      var name = new TextDecoder("utf-8").decode(rawName).replace(/\\/g, "/").replace(/^\.\/+/, "");

      if (flags & 0x0001) throw new Error("El ZIP está protegido con contraseña");
      if (compressedSize === MAX_ZIP32 || uncompressedSize === MAX_ZIP32 || localOffset === MAX_ZIP32) {
        throw new Error("El ZIP usa un formato demasiado grande (ZIP64)");
      }
      if (!name || name.charAt(0) === "/" || name.indexOf("../") >= 0 || name === "..") {
        throw new Error("El ZIP contiene una ruta no válida");
      }

      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034B50) {
        throw new Error("El ZIP está dañado");
      }
      var localNameLength = view.getUint16(localOffset + 26, true);
      var localExtraLength = view.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + localNameLength + localExtraLength;
      var dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) throw new Error("El ZIP está incompleto");

      declaredTotal += uncompressedSize;
      if (declaredTotal > MAX_TOTAL) {
        throw new Error("La copia es demasiado grande para restaurarla en este dispositivo");
      }

      var compressed = bytes.subarray(dataStart, dataEnd);
      var data;
      if (method === 0) {
        data = compressed;
      } else if (method === 8) {
        data = await inflateRaw(compressed);
      } else {
        throw new Error("El ZIP usa un método de compresión no compatible");
      }

      if (data.length !== uncompressedSize) {
        throw new Error("El ZIP está dañado (tamaño incorrecto)");
      }
      if (crc32(data) !== expectedCrc) {
        throw new Error("El ZIP está dañado (verificación fallida)");
      }

      entries.set(name, { name: name, data: data, size: data.length, method: method });
      names.push(name);

      if (typeof opts.onProgress === "function") {
        await opts.onProgress(i + 1, count, name);
      }
      position += 46 + nameLength + extraLength + commentLength;
    }

    return { entries: entries, names: names };
  }

  return {
    create: create,
    read: read,
    crc32: crc32
  };
}));
