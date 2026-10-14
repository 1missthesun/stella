import { useContext, useEffect, useState } from "react";
import { DisplayFileSourceContext } from "./display-file-source";
import { localMediaUrl } from "./local-media-url";
import { useLocalMediaFailure, type LocalMediaNoun } from "./use-local-media-failure";

const filenameOf = (filePath: string): string =>
  filePath.split(/[\\/]/).pop() ?? filePath;

export const useMediaStream = (filePath: string, noun: LocalMediaNoun) => {
  const source = useContext(DisplayFileSourceContext);
  const remote = source?.mediaUrl ?? null;
  const local = useLocalMediaFailure(filePath, noun);
  const [resolved, setResolved] = useState<{
    key: string;
    url: string | null;
    failure: string | null;
  } | null>(null);
  const key = `${source?.key ?? ""}\0${filePath}`;
  useEffect(() => {
    if (!remote) return;
    let live = true;
    void remote().then(
      (url) => {
        if (live) setResolved({ key, url, failure: null });
      },
      () => {
        if (live) {
          setResolved({ key, url: null, failure: `Couldn't load ${filenameOf(filePath)}.` });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [filePath, key, remote]);
  if (!remote) {
    return { url: localMediaUrl(filePath), failure: local.failure, onError: local.onError };
  }
  const current = resolved?.key === key ? resolved : null;
  return {
    url: current?.url ?? null,
    failure: current?.failure ?? null,
    onError: () =>
      setResolved({ key, url: null, failure: `Couldn't play ${filenameOf(filePath)}.` }),
  };
};
