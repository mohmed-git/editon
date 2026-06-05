module.exports = {
  apps: [
    {
      name: 'cinemaplus',
      script: 'npx',
      // Serve the static build from dist/ — extremely low memory footprint.
      // Directory-format Astro output means each route is its own index.html,
      // so a plain static file server resolves /x/f/ -> dist/x/f/index.html.
      args: 'serve dist -l tcp://0.0.0.0:3000 --no-clipboard',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      kill_timeout: 5000,
    },
  ],
};
