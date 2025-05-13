// /src/context/UserContext.tsx
"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type UserContextType = {
  userName: string;
  setUserName: (name: string) => void;
  cardPositions: Record<string, string[]>;
  setCardPositions: (pos: Record<string, string[]>) => void;
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
