import type { StintConfig } from "../../packages/stint/src/index.js";

export interface Designer {
  id: string;
  name: string;
  data: StintConfig;
}

/*
 * Public career outlines, approximated to the month for demo purposes.
 * They exist to stress the layout with real-world shapes: overlapping
 * studios, long titles, decades-long tenures, and careers with no
 * current role.
 */
export const designers: Designer[] = [
  {
    id: "rams",
    name: "Dieter Rams",
    data: {
      schemaVersion: 1,
      entries: [
        {
          id: "apel",
          company: "Otto Apel Architects",
          location: "Frankfurt",
          start: "1953-07",
          end: "1955-06",
          roles: [{ id: "apel-architect", title: "Architect", start: "1953-07" }],
        },
        {
          id: "braun",
          company: "Braun",
          location: "Kronberg",
          start: "1955-07",
          end: "1997-12",
          roles: [
            { id: "braun-interior", title: "Architect and Interior Designer", start: "1955-07" },
            { id: "braun-product", title: "Product Designer", start: "1956-01" },
            { id: "braun-head", title: "Head of Design", start: "1961-01" },
            { id: "braun-exec", title: "Executive Director of Corporate Identity", start: "1988-01" },
          ],
        },
        {
          id: "vitsoe",
          company: "Vitsœ",
          location: "London",
          start: "1959-01",
          end: null,
          roles: [{ id: "vitsoe-designer", title: "Furniture Designer", start: "1959-01" }],
        },
        {
          id: "hfbk",
          company: "HFBK Hamburg",
          location: "Hamburg",
          start: "1981-01",
          end: "1997-12",
          roles: [{ id: "hfbk-prof", title: "Professor of Industrial Design", start: "1981-01" }],
        },
      ],
    },
  },
  {
    id: "ive",
    name: "Jony Ive",
    data: {
      schemaVersion: 1,
      entries: [
        {
          id: "rwg",
          company: "Roberts Weaver Group",
          location: "London",
          start: "1988-07",
          end: "1989-06",
          roles: [{ id: "rwg-designer", title: "Designer", start: "1988-07" }],
        },
        {
          id: "tangerine",
          company: "Tangerine",
          location: "London",
          start: "1989-07",
          end: "1992-08",
          roles: [{ id: "tangerine-partner", title: "Partner", start: "1989-07" }],
        },
        {
          id: "apple",
          company: "Apple",
          location: "Cupertino",
          start: "1992-09",
          end: "2019-11",
          roles: [
            { id: "apple-id", title: "Industrial Designer", start: "1992-09" },
            { id: "apple-vp", title: "VP, Industrial Design", start: "1997-01" },
            { id: "apple-svp", title: "Senior Vice President, Industrial Design", start: "2005-07" },
            { id: "apple-svp-design", title: "Senior Vice President, Design", start: "2012-10" },
            { id: "apple-cdo", title: "Chief Design Officer", start: "2015-05" },
          ],
        },
        {
          id: "lovefrom",
          company: "LoveFrom",
          location: "San Francisco and London",
          start: "2019-12",
          end: null,
          roles: [{ id: "lovefrom-founder", title: "Founder", start: "2019-12" }],
        },
      ],
    },
  },
  {
    id: "kare",
    name: "Susan Kare",
    data: {
      schemaVersion: 1,
      entries: [
        {
          id: "apple",
          company: "Apple",
          location: "Cupertino",
          start: "1982-01",
          end: "1986-06",
          roles: [
            { id: "apple-icons", title: "Icon and Font Designer", start: "1982-01" },
            { id: "apple-cd", title: "Creative Director", start: "1984-06" },
          ],
        },
        {
          id: "next",
          company: "NeXT",
          location: "Redwood City",
          start: "1986-07",
          end: "1988-12",
          roles: [{ id: "next-cd", title: "Creative Director", start: "1986-07" }],
        },
        {
          id: "studio",
          company: "Susan Kare Design",
          location: "San Francisco",
          start: "1989-01",
          end: null,
          roles: [{ id: "studio-principal", title: "Principal", start: "1989-01" }],
        },
        {
          id: "pinterest",
          company: "Pinterest",
          location: "San Francisco",
          start: "2015-01",
          end: "2021-06",
          roles: [{ id: "pinterest-lead", title: "Product Design Lead", start: "2015-01" }],
        },
      ],
    },
  },
  {
    id: "vignelli",
    name: "Massimo Vignelli",
    data: {
      schemaVersion: 1,
      entries: [
        {
          id: "office",
          company: "Massimo and Lella Vignelli Office of Design and Architecture",
          location: "Milan",
          start: "1960-01",
          end: "1964-12",
          roles: [{ id: "office-founder", title: "Co-founder", start: "1960-01" }],
        },
        {
          id: "unimark",
          company: "Unimark International",
          location: "New York and Milan",
          start: "1965-01",
          end: "1971-06",
          roles: [{ id: "unimark-founder", title: "Co-founder and Design Director", start: "1965-01" }],
        },
        {
          id: "associates",
          company: "Vignelli Associates",
          location: "New York",
          start: "1971-07",
          end: "2014-05",
          roles: [{ id: "associates-principal", title: "Principal", start: "1971-07" }],
        },
      ],
    },
  },
  {
    id: "scher",
    name: "Paula Scher",
    data: {
      schemaVersion: 1,
      entries: [
        {
          id: "cbs",
          company: "CBS Records",
          location: "New York",
          start: "1972-01",
          end: "1982-12",
          roles: [
            { id: "cbs-designer", title: "Designer", start: "1972-01" },
            { id: "cbs-ad", title: "Art Director", start: "1974-01" },
          ],
        },
        {
          id: "koppel",
          company: "Koppel & Scher",
          location: "New York",
          start: "1984-01",
          end: "1991-06",
          roles: [{ id: "koppel-partner", title: "Partner", start: "1984-01" }],
        },
        {
          id: "pentagram",
          company: "Pentagram",
          location: "New York",
          start: "1991-07",
          end: null,
          roles: [{ id: "pentagram-partner", title: "Partner", start: "1991-07" }],
        },
      ],
    },
  },
];
