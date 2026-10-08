// packetEngine.js - Full 64-Bit Float64 Serialization & Compact Acoustic PHY Codec
const PacketEngine = {
  PACKET_SIZE: 40,

  encode(packet) {
    const buffer = new ArrayBuffer(this.PACKET_SIZE);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    // Byte 0: Sync Marker 'S'
    view.setUint8(0, 0x53);
    // Bytes 1-2: Message ID
    view.setUint16(1, (packet.msgId || 1000) & 0xFFFF, false);
    // Byte 3: Type
    view.setUint8(3, (packet.type || 1) & 0xFF);
    // Byte 4: TTL
    view.setUint8(4, (packet.ttl || 3) & 0xFF);

    // Bytes 5-12: EXACT 64-bit Double Precision Latitude
    view.setFloat64(5, Number(packet.lat) || 0.0, false);

    // Bytes 13-20: EXACT 64-bit Double Precision Longitude
    view.setFloat64(13, Number(packet.lon) || 0.0, false);

    // Bytes 21-22: Accuracy in Meters
    view.setUint16(21, Math.min(65535, Math.round(packet.accuracy || 5)), false);

    // Bytes 23-37: Text Payload (15 chars)
    const textBytes = new TextEncoder().encode(packet.text || "");
    for (let i = 0; i < 15; i++) {
      view.setUint8(23 + i, i < textBytes.length ? textBytes[i] : 0x20);
    }

    // Bytes 38-39: CRC-16 Checksum
    const crc = CRC16.compute(uint8.subarray(0, 38));
    view.setUint16(38, crc, false);

    return uint8;
  },

  decode(uint8Array) {
    if (!uint8Array || uint8Array.length < this.PACKET_SIZE) return null;
    const view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);

    const receivedCrc = view.getUint16(38, false);
    const computedCrc = CRC16.compute(uint8Array.subarray(0, 38));
    if (receivedCrc !== computedCrc && uint8Array[0] !== 0x53) return null;

    const msgId = view.getUint16(1, false);
    const type = view.getUint8(3);
    const ttl = view.getUint8(4);
    const lat = view.getFloat64(5, false);
    const lon = view.getFloat64(13, false);
    const accuracy = view.getUint16(21, false);

    const textBytes = uint8Array.subarray(23, 38);
    const text = new TextDecoder().decode(textBytes).trim();

    return {
      msgId,
      type,
      ttl,
      lat,
      lon,
      accuracy,
      text
    };
  },

  encodeAck(msgId) {
    const buffer = new ArrayBuffer(this.PACKET_SIZE);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    view.setUint8(0, 0x53);
    view.setUint16(1, (msgId || 1000) & 0xFFFF, false);
    view.setUint8(3, 0xFF); // 0xFF = ACK

    const crc = CRC16.compute(uint8.subarray(0, 38));
    view.setUint16(38, crc, false);

    return uint8;
  },

  // Compact High-Speed Acoustic Emergency Beacon (14 bytes for SOS, 6 bytes for ACK / Test Ping)
  encodeAcoustic(packet) {
    const isShort = packet.type === 0xFF || packet.type === 0xFD;
    const len = isShort ? 6 : 14;
    const buf = new ArrayBuffer(len);
    const view = new DataView(buf);
    const uint8 = new Uint8Array(buf);

    view.setUint8(0, 0x53); // 'S' marker
    view.setUint16(1, (packet.msgId !== undefined && packet.msgId !== null ? Number(packet.msgId) : 0) & 0xFFFF, false);
    view.setUint8(3, (packet.type || 1) & 0xFF);

    if (isShort) {
      const crc = CRC16.compute(uint8.subarray(0, 4));
      view.setUint16(4, crc, false);
    } else {
      // 5 decimal places provides ~1.1 meter satellite precision
      view.setInt32(4, Math.round((Number(packet.lat) || 0) * 100000), false);
      view.setInt32(8, Math.round((Number(packet.lon) || 0) * 100000), false);
      const crc = CRC16.compute(uint8.subarray(0, 12));
      view.setUint16(12, crc, false);
    }

    return uint8;
  },

  decodeAcoustic(uint8Array) {
    if (!uint8Array || uint8Array.length < 6) return null;
    const view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);

    if (view.getUint8(0) !== 0x53) return null;

    const type = view.getUint8(3);
    const isShort = type === 0xFF || type === 0xFD;

    if (isShort) {
      const receivedCrc = view.getUint16(4, false);
      const computedCrc = CRC16.compute(uint8Array.subarray(0, 4));
      if (receivedCrc !== computedCrc) return null;

      const msgId = view.getUint16(1, false);
      const isBroadcast = (msgId === 0 || msgId === 1000);
      return {
        msgId,
        type,
        isBroadcast,
        isTest: type === 0xFD,
        text: type === 0xFD ? "Acoustic Test Ping" : "ACK"
      };
    } else {
      if (uint8Array.length < 14) return null;

      const receivedCrc = view.getUint16(12, false);
      const computedCrc = CRC16.compute(uint8Array.subarray(0, 12));
      if (receivedCrc !== computedCrc) return null;

      const msgId = view.getUint16(1, false);
      const lat = view.getInt32(4, false) / 100000;
      const lon = view.getInt32(8, false) / 100000;

      return {
        msgId,
        type,
        lat,
        lon,
        accuracy: 10,
        ttl: 3,
        text: "Off-Grid Acoustic SOS",
        isPanic: type === 2
      };
    }
  }
};

if (typeof window !== 'undefined') {
  window.PacketEngine = PacketEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PacketEngine;
}