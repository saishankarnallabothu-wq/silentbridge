// crc16.js - CCITT CRC-16 (Polynomial 0x1021)
class CRC16 {
  static compute(uint8Array) {
    let crc = 0xFFFF;
    for (let i = 0; i < uint8Array.length; i++) {
      crc ^= (uint8Array[i] << 8);
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc;
  }

  static verify(uint8Array, expectedCrc) {
    return this.compute(uint8Array) === expectedCrc;
  }
}

if (typeof window !== 'undefined') {
  window.CRC16 = CRC16;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CRC16;
}