// packetEngine.js - Full 64-Bit Float64 Double Precision Lossless Serialization
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
  }
};

window.PacketEngine = PacketEngine;