function sharp() {
  return {
    metadata: async () => ({ channels: 3 }),
    rotate: () => ({
      raw: () => ({
        toBuffer: async () => ({
          data: Buffer.alloc(0),
          info: { width: 1, height: 1, channels: 3 },
        }),
      }),
    }),
  }
}

module.exports = sharp
module.exports.default = sharp
