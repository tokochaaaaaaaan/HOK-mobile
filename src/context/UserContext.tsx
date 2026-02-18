// /src/context/UserContext.tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  Dispatch,
  SetStateAction,
} from "react";

type UserContextType = {
  userName: string;
  setUserName: (name: string) => void;
  cardPositions: Record<string, string[]>;
  setCardPositions: Dispatch<SetStateAction<Record<string, string[]>>>;
};

const defaultPositions: Record<string, string[]> = {
  行きたい: [],
  "どちらでもいい": [],
  行きたくない: [],
};

const UserContext = createContext<UserContextType>({
  userName: "",
  setUserName: () => {},
  cardPositions: defaultPositions,
  setCardPositions: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [userName, setUserName] = useState("");
  const [cardPositions, setCardPositions] = useState(defaultPositions);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem("hok3:userName");
      if (stored) {
        setUserName(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (userName) {
        window.sessionStorage.setItem("hok3:userName", userName);
      } else {
        window.sessionStorage.removeItem("hok3:userName");
      }
    } catch {}
  }, [userName]);

  return (
    <UserContext.Provider
      value={{ userName, setUserName, cardPositions, setCardPositions }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
