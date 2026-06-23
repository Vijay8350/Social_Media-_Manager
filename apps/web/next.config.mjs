/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @insta/shared is a workspace TS package consumed as source.
  transpilePackages: ["@insta/shared"],
};

export default nextConfig;
