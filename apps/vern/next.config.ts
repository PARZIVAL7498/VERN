import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vern/core'],
  serverExternalPackages: ['edge-tts-universal'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
