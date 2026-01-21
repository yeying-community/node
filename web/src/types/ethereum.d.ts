import { providers } from 'ethers';

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: true;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, callback: (...args: any[]) => void) => void;
      removeListener?: (event: string, callback: (...args: any[]) => void) => void;
      // 可根据需要添加更多属性
    };

    // 可选：如果你也使用 web3
    web3?: any;
  }
}