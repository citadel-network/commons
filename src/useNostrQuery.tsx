import { useEffect, useState, useRef } from "react";
import { Event, Filter, SimplePool } from "nostr-tools";
import { Collection, List, Map, OrderedMap } from "immutable";

export const KIND_RELAY_METADATA_EVENT = 10002;

export type Relay = {
    url: string;
    read: boolean;
    write: boolean;
  };

type EventQueryResult = {
  events: OrderedMap<string, Event>;
  eose: boolean;
};

type EventQueryProps = {
  enabled?: boolean;
  readFromRelays?: Array<Relay>;
};

export function findAllTags(
  event: Event,
  tag: string
): Array<Array<string>> | undefined {
  const filtered = event.tags.filter(([tagName]) => tagName === tag);
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.map((t) => t.slice(1));
}

export function findTag(event: Event, tag: string): string | undefined {
  const allTags = findAllTags(event, tag);
  return allTags && allTags[0] && allTags[0][0];
}

export function sortEvents(events: List<Event>): List<Event> {
  return events.sortBy((event, index) =>
    parseFloat(`${event.created_at}.${index}`)
  );
}

export function sortEventsDescending(events: List<Event>): List<Event> {
  return events.sortBy((event, index) =>
    parseFloat(`${-event.created_at}.${index}`)
  );
}

export function getMostRecentReplacableEvent(
  events: Collection<string, Event> | List<Event>
): Event | undefined {
  const listOfEvents = List.isList(events) ? events : events.toList();
  return sortEventsDescending(listOfEvents).first(undefined);
}

export function useEventQuery(
  relayPool: SimplePool,
  filters: Filter<number>[],
  opts?: EventQueryProps
): EventQueryResult {
  const [events, setEvents] = useState<Map<string, Event>>(
    OrderedMap<string, Event>()
  );
  const [eose, setEose] = useState<boolean>(false);

  const componentIsMounted = useRef(true);
  useEffect(() => {
    return () => {
      // eslint-disable-next-line functional/immutable-data
      componentIsMounted.current = false;
    };
  }, []);

  const enabled = !(opts && opts.enabled === false);
  const relayUrls =
    opts && opts.readFromRelays ? opts.readFromRelays.map((r) => r.url) : [];

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    }
    const sub = relayPool.sub(relayUrls, filters);
    const eventHandler = (event: Event): void => {
      if (!componentIsMounted.current) {
        return;
      }
      setEvents((existingEvents) => {
        if (existingEvents.has(event.id)) {
          return existingEvents;
        }
        return existingEvents.set(event.id, event);
      });
    };

    sub.on("eose", () => {
      if (componentIsMounted.current && !eose) {
        setEose(true);
      }
    });
    sub.on("event", eventHandler);

    return () => {
      sub.unsub();
    };
  }, [
    enabled,
    JSON.stringify(relayUrls),
    JSON.stringify(filters),
    componentIsMounted.current,
  ]);
  return {
    events,
    eose,
  };
}

function findAllRelays(event: Event): Array<Relay> {
  const relayTags = findAllTags(event, "r");
  if (!relayTags) {
    return [];
  }
  return relayTags
    .filter((tag) => tag.length >= 1)
    .map((tag) => {
      const { length } = tag;
      const url = tag[0];
      if (length === 1) {
        return {
          url,
          read: true,
          write: true,
        };
      }
      const read =
        (length >= 2 && tag[1] === "read") ||
        (length >= 3 && tag[2] === "read");
      const write =
        (length >= 2 && tag[1] === "write") ||
        (length >= 3 && tag[2] === "write");
      return {
        url,
        read,
        write,
      };
    });
}

function createRelaysQuery(nostrPublicKeys: Array<string>): Filter<number> {
  return {
    kinds: [KIND_RELAY_METADATA_EVENT],
    authors: nostrPublicKeys,
  };
}

export function useRelaysQuery(
  simplePool: SimplePool,
  authors: Array<string>,
  enabled: boolean,
  startingRelays: Array<Relay>
): {
  relays: Array<Relay>;
  eose: boolean;
} {
  const { events, eose } = useEventQuery(simplePool, [createRelaysQuery(authors)], {
    enabled,
    readFromRelays: startingRelays,
  });

  if (!eose) {
    return { relays: startingRelays, eose };
  }
  const newestEvent = getMostRecentReplacableEvent(events);

  if (newestEvent) {
    return { relays: findAllRelays(newestEvent), eose };
  }
  return { relays: startingRelays, eose };
}
