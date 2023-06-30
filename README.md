---
Type: Qlik Sense Visualization Extension
Name: E-mergo App Inspector
Version: 1.0-beta.2
QEXT: qs-emergo-app-inspector.qext
---

# E-mergo App Inspector

**E-mergo App Inspector** is a Qlik Sense extension developed by [E-mergo](https://www.e-mergo.nl). This extension provides insight in the contents of a single app (or all apps) in the Qlik Sense environment.

This extension is part of the [E-mergo Tools bundle](https://www.e-mergo.nl/e-mergo-tools-bundle/?utm_medium=download&utm_source=tools_bundle&utm_campaign=E-mergo_Extension&utm_term=toolsbundle&utm_content=sitelink).

This extension is [hosted on GitHub](https://github.com/e-mergo/qs-emergo-app-inspector). You can report bugs and discuss features on the [issues page](https://github.com/e-mergo/qs-emergo-app-inspector/issues).

## Why is this extension needed?
When working on apps made by other developers, it can be hard to get a good understanding of what is going on. This confrontation warrants the desire to get a global overview of an app's details and the app objects in use. As the wide variation of these aspects vary in location and accessability however, it can be difficult to get the full picture of an app.

This extension removes the barriers for inspecting app details and app objects by offering an instant overview of the app. The parts of the app that are presented for inspection are App, Script, Fields, Sheets, Charts, Extensions, Dimension master items, Measure master items, Visualization master items, Alternate states, Variables, and Bookmarks.

## Disclaimer
This extension is created free of charge for Qlik Sense app developers, personal or professional. E-mergo developers aim to maintain the functionality of this extension with each new release of Qlik Sense. However, this product does not ship with any warranty of support. If you require any updates to the extension or would like to request additional features, please inquire for E-mergo's commercial plans for supporting your extension needs at support@e-mergo.nl.

On server installations that do not already have it registered, the Markdown file mime type will be registered when opening the documentation page. This is required for Qlik Sense to be able to successfully return `.md` files when those are requested from the Qlik Sense web server. Note that registering the file mime type is only required once and is usually only allowed for accounts with RootAdmin level permissions.

## Features
Below is a detailed description of the available features of this extension.

### No Settings
This extension is plug-and-play as it works with zero property settings. Insert the extension on a sheet and start inspecting your app!

### Inspected assets
When inspecting the app, the following assets from the app are presented:

#### App
- Main properties.
- App options.
- Technical properties.
- Configuration and environment properties.

#### Script
- Script sections.

#### Fields
- Fields along with their distinct values and tags.

#### Sheets
- Sheets along with their visualization objects, grid cells and grid size.

#### Charts
- The distinct types of native visualization objects used within the app along with the sheets they appear on.

#### Extensions
- The distinct types of extension visualization objects used within the app along with the sheets they appear on.

#### Dimensions
- Master dimensions along with their description, type, applied fields and tags.

#### Measures
- Master measures along with their description, type, expression and tags.

#### Visualizations (master objects)
- Master visualizations along with their type and tags.

#### Alternate states
- Alternate states.

#### Variables
- System variables.
- Variables along with their description, definition and tags.

#### Bookmarks
- Bookmarks along with their description, set-expression, selected fields and a marking for the default bookmark.

### Code

For all asset items the underlying technical data definition derived from the Qlik Sense Engine is available. In the *Code* section a textbox contains this definition, being it in JSON format or otherwise. The *Copy* button helps copying the code to the system's clipboard. The intention of this functionality is to increase understanding of Qlik Sense's logic as well as to assist in the inspection of parts of the app.

## FAQ

### Can I get support for this extension?
E-mergo provides paid support through standard support contracts. For other scenarios, you can post your bugs or questions in the extension's GitHub repository.

### Can you add feature X?
Requests for additional features can be posted in the extension's GitHub repository. Depending on your own code samples and the availability of E-mergo developers your request may be considered and included.

## Changelog

#### 1.0-beta - QS November 2022
Public release. Ready for Qlik Cloud.

#### 0.1.20201109
Initial release.
