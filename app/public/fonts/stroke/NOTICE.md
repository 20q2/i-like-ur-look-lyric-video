# Single-stroke fonts: credits and licences

The SVG fonts in this directory come from Evil Mad Scientist's SVG font collection for Hershey
Text (https://gitlab.com/oskay/svg-fonts), via the reference app (mexicat/pdoom-video, whose
README credits them to the `hersheytext` package). Each
file carries its own credits and licence in its `<metadata>` element; this file repeats them.
The upstream collection's README says the same: credits and licence information are embedded in
each font, the classic Hershey fonts derive from Dr. A. V. Hershey's work, and the "EMS" fonts
are derivatives of fonts under the SIL Open Font License.

## Hershey fonts

`HersheySans1.svg` (Hershey Sans 1-stroke), `HersheyScript1.svg` (Hershey Script 1-stroke),
`HersheySerifMed.svg` (Hershey Serif medium). Converted to SVG fonts in 2019 by Windell H. Oskay
(www.evilmadscientist.com), adapted from emergent.unpythonic.net/software/hershey by way of
"Hershey Fonts in SVG" by Marty McGuire (http://www.thingiverse.com/thing:6168).

They are not under a formal licence. The notice embedded in all three files (the same text in
each) allows any use, commercial or not, on two conditions: the acknowledgements below go with
the font data, and the data is not converted to the NTIS format. The notice, verbatim:

```
The Hershey Fonts are a set of vector fonts with a liberal license.

USE RESTRICTION:
    This distribution of the Hershey Fonts may be used by anyone for
    any purpose, commercial or otherwise, providing that:
        1. The following acknowledgements must be distributed with
            the font data:
            - The Hershey Fonts were originally created by Dr.
                A. V. Hershey while working at the U. S.
                National Bureau of Standards.
            - The format of the Font data in this distribution
                was originally created by
                    James Hurt
                    Cognition, Inc.
                    900 Technology Park Drive
                    Billerica, MA 01821
                    (mit-eddie!ci-dandelion!hurt)
        2. The font data in this distribution may be converted into
            any other format *EXCEPT* the format distributed by
            the U.S. NTIS where each point is described
            in eight bytes as "xxx yyy:", where xxx and yyy are
            the coordinate values as ASCII numbers.
```

## EMS fonts

Single-stroke derivatives created by Sheldon B. Michaels, converted to SVG fonts by Windell H.
Oskay. Each file's metadata gives its licence as the SIL Open Font License
(http://scripts.sil.org/OFL). The full OFL 1.1 text is in `../src/OFL.txt` (the licence text is the
same for every OFL font; only the copyright line at the top of that file differs).

| File | Derivative of | Designer (from the metadata) | Parent font's copyright line (from its OFL.txt in google/fonts) |
|---|---|---|---|
| `EMSAllure.svg` | Allura | Rob Leuschke, TypeSETit | Copyright 2010 The Allura Project Authors (https://github.com/googlefonts/allura) |
| `EMSFelix.svg` | Felipa | Fontstage | Copyright (c) 2011 Fontstage (info@fontstage.com), with Reserved Font Names, 'Felipa' |
| `EMSOsmotron.svg` | Orbitron (Regular) | Matt McInerney, the League of Moveable Type | Copyright 2018 The Orbitron Project Authors (https://github.com/theleagueof/orbitron), with Reserved Font Name: "Orbitron" |
| `EMSReadability.svg` | Source Sans Pro Light | Paul D. Hunt, Adobe | Copyright 2010, 2012, 2014 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'. (from adobe-fonts/source-sans, 2.020R-ro/1.075R-it, the last Source Sans Pro release) |
| `EMSTech.svg` | Architects Daughter | Kimberly Geswein, Kimberly Geswein Fonts | Copyright (c) 2010, Kimberly Geswein (kimberlygeswein.com) |

The EMS files contain no copyright line of their own, only the metadata above. The parent
fonts' copyright lines were taken from their current OFL.txt files (google/fonts `ofl/<name>/OFL.txt`,
and the Adobe repository for Source Sans Pro) and may differ from the text that shipped with the
exact font versions Sheldon B. Michaels started from.
