module.exports = {
  apps: [
    {
      name: 'steam-cardsets-showcase',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 7000,
      },
    },
  ],
};
