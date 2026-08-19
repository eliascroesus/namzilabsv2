/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dev-tools button defaults to bottom-left — the exact pixels where the
  // navigation rail keeps the account avatar, so in every dev session the
  // overlay sat on top of a real control and swallowed its clicks. Dev-only
  // either way; production never renders the indicator.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
