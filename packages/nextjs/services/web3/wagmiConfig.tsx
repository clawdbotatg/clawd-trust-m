import { wagmiConnectors } from "./wagmiConnectors";
import { Chain, createClient, custom, http } from "viem";
import { hardhat, mainnet } from "viem/chains";
import { createConfig } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";
import { getAlchemyHttpUrl } from "~~/utils/scaffold-eth";

const { targetNetworks } = scaffoldConfig;

// We always want to have mainnet enabled (ENS resolution, ETH price, etc). But only once.
export const enabledChains = targetNetworks.find((network: Chain) => network.id === 1)
  ? targetNetworks
  : ([...targetNetworks, mainnet] as const);

export const wagmiConfig = createConfig({
  chains: enabledChains,
  connectors: wagmiConnectors(),
  ssr: true,
  client: ({ chain }) => {
    const alchemyHttpUrl = getAlchemyHttpUrl(chain.id);
    return createClient({
      chain,
      transport: alchemyHttpUrl
        ? http(alchemyHttpUrl)
        : custom(
            {
              async request() {
                throw new Error("Verification unavailable: configure NEXT_PUBLIC_ALCHEMY_API_KEY for this network.");
              },
            },
            { retryCount: 0 },
          ),
      ...(chain.id !== (hardhat as Chain).id ? { pollingInterval: scaffoldConfig.pollingInterval } : {}),
    });
  },
});
