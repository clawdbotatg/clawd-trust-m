"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { encodeAbiParameters, keccak256 } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const CONTRACT = deployedContracts[1].TrustMAttest.address;

type Sig = {
  message?: string;
  hash: `0x${string}`;
  r: `0x${string}`;
  s: `0x${string}`;
  chipX: `0x${string}`;
  chipY: `0x${string}`;
};
type Cert = {
  issuer?: string;
  chipX: `0x${string}`;
  chipY: `0x${string}`;
  attest: {
    cert: `0x${string}`;
    tbsStart: number;
    tbsLen: number;
    pkOffset: number;
    r: `0x${string}`;
    s: `0x${string}`;
  };
};

const parse = <T,>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

const keyId = (x?: `0x${string}`, y?: `0x${string}`) =>
  x && y ? keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [x, y])) : undefined;

const short = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");

// tools/chip.py ui opens this page as /#sig=<url-encoded JSON>; the hash never reaches the server.
const sigFromUrl = () => {
  const m = window.location.hash.match(/^#sig=(.*)$/);
  return m ? decodeURIComponent(m[1]) : "";
};

type Pending = { id: string; message: string; hash: `0x${string}` };

const Home: NextPage = () => {
  const [sigText, setSigText] = useState("");
  const [certText, setCertText] = useState("");
  const [message, setMessage] = useState("hello world");
  const [asking, setAsking] = useState<Pending | undefined>();
  const [askError, setAskError] = useState("");
  const [serverVerdict, setServerVerdict] = useState<boolean | undefined>(); // what the queue saw on mainnet
  useEffect(() => {
    const load = () => {
      const s = sigFromUrl();
      if (s) setSigText(s);
    };
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);

  // Ask the chip: POST the message, then poll until the Pico signs or refuses.
  const ask = async () => {
    setAskError("");
    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setAsking(await res.json());
    } catch (e) {
      setAskError(`could not reach the queue: ${(e as Error).message}`);
    }
  };
  useEffect(() => {
    if (!asking) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/sign/${asking.id}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j.status === "signed") {
        const s: Sig = { message: j.message, hash: j.hash, r: j.r, s: j.s, chipX: j.chipX, chipY: j.chipY };
        setServerVerdict(typeof j.verdict === "boolean" ? j.verdict : undefined);
        setSigText(JSON.stringify(s));
        window.location.hash = "sig=" + encodeURIComponent(JSON.stringify(s));
        setAsking(undefined);
      } else if (j.status === "refused") {
        setAskError("refused on the chip");
        setAsking(undefined);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [asking]);

  const sig = parse<Sig>(sigText);
  const cert = parse<Cert>(certText);
  const { data: chainVerdict, isFetching } = useScaffoldReadContract({
    contractName: "TrustMAttest",
    functionName: "isChipSignature",
    args: sig
      ? [sig.chipX, sig.chipY, sig.hash, sig.r, sig.s]
      : [undefined, undefined, undefined, undefined, undefined],
    query: { enabled: !!sig },
  });
  const { data: sigKeyAttested } = useScaffoldReadContract({
    contractName: "TrustMAttest",
    functionName: "attested",
    args: [keyId(sig?.chipX, sig?.chipY)],
    query: { enabled: !!sig },
  });
  const { data: certKeyAttested } = useScaffoldReadContract({
    contractName: "TrustMAttest",
    functionName: "attested",
    args: [keyId(cert?.chipX, cert?.chipY)],
    query: { enabled: !!cert },
  });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "TrustMAttest" });

  // The browser's own read wins when it works; otherwise the queue's server-side read (blocked RPCs, no wallet).
  const verdict = chainVerdict ?? serverVerdict;
  const settled = sig && !isFetching && verdict !== undefined;
  const step = (ok: boolean | undefined) => (ok === undefined ? "○" : ok ? "✓" : "✗");

  return (
    <div className="flex flex-col items-center grow pt-10 px-5 gap-8 max-w-3xl mx-auto w-full">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Did a real chip sign this?</h1>
        <p className="mt-3">
          An Infineon OPTIGA Trust M holds a key that never leaves the silicon. Infineon signed a certificate for that
          key at the factory. A contract on Ethereum mainnet holds Infineon&apos;s CA key, has checked that certificate,
          and now answers one question about any signature: did this chip make it?
        </p>
        <div className="flex justify-center items-center gap-2 mt-2 text-sm">
          <span>Contract:</span>
          <Address address={CONTRACT} />
        </div>
      </div>

      <section className="card bg-base-100 shadow w-full">
        <div className="card-body gap-4">
          {sig ? (
            <>
              <div className="text-sm opacity-70">The chip signed</div>
              <div className="text-3xl font-mono font-bold break-words">&quot;{sig.message ?? "(hash only)"}&quot;</div>
              <div className="font-mono text-xs opacity-70 break-all">keccak256 {sig.hash}</div>
              {verdict === undefined ? (
                <div className="flex items-center gap-2">
                  <span className="loading loading-spinner" /> asking mainnet…
                </div>
              ) : verdict ? (
                <div className="alert alert-success text-lg">
                  Yes. A real Infineon Trust M signed this, and the chain can prove it.
                </div>
              ) : sigKeyAttested === false ? (
                <div className="alert alert-warning">
                  This key is not attested yet. Attest its certificate below first.
                </div>
              ) : (
                <div className="alert alert-error">No. This is not a valid signature from that chip.</div>
              )}
              <ul className="text-sm font-mono leading-7 m-0 p-0 list-none">
                <li>{step(settled ? true : undefined)} Infineon Trust M CA 101 key is pinned in the contract</li>
                <li>
                  {step(sigKeyAttested)} CA signed the factory certificate of chip key {short(sig.chipX)}
                </li>
                <li>{step(settled ? !!verdict : undefined)} chip key signed keccak256 of the message</li>
              </ul>
              <div className="text-xs opacity-70 font-mono break-all">
                r {sig.r}
                <br />s {sig.s}
              </div>
              <button className="btn btn-ghost btn-sm self-start" onClick={() => setSigText("")}>
                check another
              </button>
            </>
          ) : (
            <>
              <h2 className="card-title">Sign something with the chip</h2>
              <div className="flex gap-2">
                <input
                  className="input input-bordered grow font-mono"
                  value={message}
                  maxLength={200}
                  onChange={e => setMessage(e.target.value)}
                  disabled={!!asking}
                />
                <button className="btn btn-primary" onClick={ask} disabled={!!asking || !message.trim()}>
                  {asking ? <span className="loading loading-spinner" /> : "Ask the chip to sign"}
                </button>
              </div>
              {asking && (
                <div className="alert">
                  Sent to the Pico. It shows &quot;{asking.message}&quot; on its screen. Press <b>A</b> there.
                </div>
              )}
              {askError && <div className="alert alert-error">{askError}</div>}
            </>
          )}
        </div>
      </section>

      <details className="collapse collapse-arrow bg-base-100 shadow w-full">
        <summary className="collapse-title font-semibold">Paste a signature from tools/chip.py sign</summary>
        <div className="collapse-content flex flex-col gap-2">
          <textarea
            className="textarea textarea-bordered font-mono text-xs h-32"
            placeholder='{"message":"hello world","hash":"0x..","r":"0x..","s":"0x..","chipX":"0x..","chipY":"0x.."}'
            value={sigText}
            onChange={e => setSigText(e.target.value)}
          />
          {sigText && !sig && <div className="text-error text-sm">not valid JSON</div>}
        </div>
      </details>

      <details className="collapse collapse-arrow bg-base-100 shadow w-full">
        <summary className="collapse-title font-semibold">Attest a new chip (once per chip)</summary>
        <div className="collapse-content flex flex-col gap-2">
          <p className="m-0 text-sm">
            Run <code>tools/chip.py cert</code>, paste the JSON, and send the transaction. The contract checks that
            Infineon&apos;s CA signed the certificate and records the chip&apos;s public key.
          </p>
          <textarea
            className="textarea textarea-bordered font-mono text-xs h-32"
            placeholder='{"issuer":"...","chipX":"0x..","chipY":"0x..","attest":{"cert":"0x..","tbsStart":4,"tbsLen":386,"pkOffset":209,"r":"0x..","s":"0x.."}}'
            value={certText}
            onChange={e => setCertText(e.target.value)}
          />
          {certText && !cert && <div className="text-error text-sm">not valid JSON</div>}
          {cert && (
            <div className="flex flex-col gap-2">
              <div className="text-sm">
                Issuer: {cert.issuer ?? "?"}
                <br />
                Key: {short(cert.chipX)} / {short(cert.chipY)}
              </div>
              {certKeyAttested ? (
                <div className="alert alert-success">This chip is already attested.</div>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={isMining}
                  onClick={() =>
                    writeContractAsync({
                      functionName: "attest",
                      args: [
                        cert.attest.cert,
                        BigInt(cert.attest.tbsStart),
                        BigInt(cert.attest.tbsLen),
                        BigInt(cert.attest.pkOffset),
                        cert.attest.r,
                        cert.attest.s,
                      ],
                    })
                  }
                >
                  {isMining ? "Sending…" : "Attest this chip"}
                </button>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
};

export default Home;
