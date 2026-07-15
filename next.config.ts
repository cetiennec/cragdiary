import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
      // The NanoCorp custom-domain proxy forwards `x-forwarded-host` as the
      // internal *.vercel.app hostname, which never matches the browser's
      // Origin header on the public domain — without this, every form
      // submission (login, new entry, delete) fails Next's CSRF check.
      allowedOrigins: ["cragdiary.nanocorp.app"],
    },
  },
};

export default nextConfig;
