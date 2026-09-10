/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    // This machine deadlocks Next's parallel build workers (they SIGTERM on a
    // 60s timeout and the build then hangs at 0% CPU). Build single-threaded.
    workerThreads: false,
    cpus: 1,
  },
};

export default nextConfig;
