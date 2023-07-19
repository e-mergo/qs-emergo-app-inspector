/**
 * E-mergo App Inspector Extension
 *
 * @since 20190920
 * @author Laurens Offereins <https://github.com/lmoffereins>
 *
 * @param  {Object} qlik                Qlik's core API
 * @param  {Object} qvangular           Qlik's Angular implementation
 * @param  {Object} _                   Underscore
 * @param  {Object} $q                  Angular's Q promise library
 * @param  {Object} translator          Qlik's translation API
 * @param  {Object} Resize              Qlik's resize API
 * @param  {Object} props               Property panel definition
 * @param  {Object} initProps           Initial properties
 * @param  {Object} util                E-mergo utility functions
 * @param  {String} css                 Extension stylesheet
 * @param  {String} tmpl                Extension template file
 * @param  {String} modalTmpl           Extension modal template file
 * @return {Object}                     Extension structure
 */
define([
	"qlik",
	"qvangular",
	"underscore",
	"ng!$q",
	"translator",
	"core.utils/resize",
	"./properties",
	"./initial-properties",
	"./util/app-info",
	"./util/util",
	"./util/ui-util",
	"text!./style.css",
	"text!./template.ng.html",
	"text!./modal.ng.html"
], function( qlik, qvangular, _, $q, translator, Resize, props, initProps, appInfo, util, uiUtil, css, tmpl, modalTmpl ) {

	// Add global styles to the page
	util.registerStyle("qs-emergo-app-inspector", css);

	/**
	 * Holds the current app
	 *
	 * @type {Object}
	 */
	var currApp = qlik.currApp(),

	/**
	 * Holds the list of opened apps
	 *
	 * @type {Object}
	 */
	_apps = {},

	/**
	 * Return the opened app
	 *
	 * Use this to make sure always only one connection per app is created.
	 *
	 * @param  {String} appId App identifier
	 * @return {Promise}      App object or rejected when not found
	 */
	openApp = function( appId ) {

		// Bail when no data was provided
		if (! appId) {
			return $q.reject("App with id '".concat(appId, "' not found"));
		}

		// Return when appId already is an app
		if (appId.id) {
			return $q.resolve(appId);
		}

		// Set current app
		if (! _apps.hasOwnProperty(currApp.id)) {
			_apps[currApp.id] = $q.resolve(currApp);
		}

		// Load the requested app
		if (! _apps.hasOwnProperty(appId)) {
			var app = qlik.openApp(appId, { openWithoutData: true });

			_apps[appId] = app.model.waitForOpen.promise.then( function() {
				var dfd = $q.defer();

				// No way was found to listen for the event that the app's layout is
				// loaded, so a delay is applied to ensure the API request must have
				// returned any value.
				setTimeout(function() { dfd.resolve(app); }, 120);

				return dfd.promise;
			});
		}

		return _apps[appId];
	},

	/**
	 * Get the app's sheet information
	 *
	 * @param  {Object}  app     The app's API
	 * @param  {Object}  options Optional. Sheet info query parameters.
	 * @return {Promise}         List of app sheets
	 */
	getSheetInfo = function( app, options ) {
		return appInfo.sheets(app.id, _.defaults(options || {}, {
			loadWithObjects: true,
			includeSummary: true,
			validate: true
		})).then( function( info ) {
			return info.map( function( a, index ) {

				// Define preview. Ignore first item Summary
				if (index) {
					a.preview = {
						url: getSingleSheetUrl({
							appId: app.id,
							sheetId: a.id,
							opts: "nointeraction,noselections"
						})
					};
				}

				return a;
			});
		});
	},

	/**
	 * Return unique app objects from sheets
	 *
	 * Extension metadata is stored in the visualization object on creation, so it 
	 * doesn't reflect the actively installed version of the extension. Therefore
	 * extension metadata is loaded from the extensionList parameter.
	 *
	 * @param  {Object} sheetInfo     Sheet information
	 * @param  {Object} extensionList Extension metatdata
	 * @param  {Object} app           The app's API
	 * @return {Array}                Unique app objects
	 */
	getUniqueAppObjectsFromSheets = function( sheetInfo, extensionList, app ) {

		// Derive sheet objects from sheet info
		var sheetObjects = _.flatten(sheetInfo.map( function( sheet ) {
			return (sheet.visualizations || []).map( function( object ) {
				return {
					id: object.cell.name,
					details: {
						sheet: sheet.id
					},
					errors: object.errors,
					meta: object.properties.extensionMeta || {
						name: object.properties.qInfo.qType,
						template: object.properties.qInfo.qType,
						isThirdParty: false
					},
					properties: object.properties,
					children: object.children,
					masterobject: object.masterobject
				};
			});
		}), 1); // flatten 1 level

		// Setup unique sheet objects based on template type
		return _.uniq(sheetObjects, false, function( a ) {
			return a.properties.qInfo.qType;
		}).map( function( template ) {
			var item, extensionMetadata = {}, details,

			// Get all objects of the template type
			objects = sheetObjects.filter( function( a ) {
				return template.properties.qInfo.qType === a.properties.qInfo.qType;
			}),

			// Working with multiple items?
			isMultipleItems = objects.length > 1,

			// Working with a single item
			isSingleItem = ! isMultipleItems,

			hasError = (isSingleItem && objects[0].errors.length) || (isMultipleItems && -1 !== objects.findIndex( function( item ) {
				return item.errors.length;
			})),

			// Get all sheets of the related objects
			sheets = objects.map( function( a ) {
				return sheetInfo.find( function( b ) {
					return b.id === a.details.sheet;
				});
			});

			// Get extension metadata from extension list
			if (extensionList.hasOwnProperty(template.meta.template)) {
				extensionMetadata = extensionList[template.meta.template];
			}

			// Setup global details
			details = {
				masterobject: {
					label: translator.get("properties.masterItem"),
					value: isSingleItem && objects[0].masterobject && objects[0].masterobject.qMetaDef.title || null
				},
				version: {
					label: translator.get("geo.properties.wms.version"), // Translation contains just 'Version'
					value: extensionMetadata.version || null
				},
				title: {
					label: translator.get("Common.Title"),
					value: objects[0].properties.title && objects[0].properties.title.qStringExpression ? objects[0].properties.title.qStringExpression.qExpr : objects[0].properties.title
				},
				subtitle: {
					label: translator.get("properties.subtitle"),
					value: objects[0].properties.subtitle && objects[0].properties.subtitle.qStringExpression ? objects[0].properties.subtitle.qStringExpression.qExpr : objects[0].properties.subtitle
				},
				description: {
					label: translator.get("Common.Description"),
					value: extensionMetadata.description || null
				},
				author: {
					label: translator.get("Author"),
					value: extensionMetadata.author || null
				},
				bundle: {
					label: translator.get("Bundle"),
					value: extensionMetadata.bundle && extensionMetadata.bundle.name || null
				},
				sheets: {
					label: translator.get("Common.Sheets"),
					value: _.uniq(sheets, false, function( a ) {
						return a.label;
					}).map( function( a ) {

						// Get the sheet count
						var count = sheets.filter( function( b ) { return a.label === b.label; }).length;

						return (count > 1 ? count + " x " : "") + a.label;
					})
				}
			};

			// Start
			item = {
				id: template.properties.qInfo.qType,
				label: extensionMetadata.name || template.meta.name,
				icon: hasError ? "debug" : "",
				isThirdParty: template.meta.isThirdParty,
				isMasterObject: isSingleItem ? objects[0].masterobject && objects[0].masterobject.qInfo.qId : false,
				count: isSingleItem ? 0 : objects.length, // 1 is already assumed, so hide counter by setting 0
				details: details,
				errors: isSingleItem ? objects[0].errors : false,
				searchTerms: ""
			};

			// Multi-item having children
			if (isMultipleItems) {

				// Remove single item details
				item.details = _.omit(item.details, ["title", "subtitle"]);

				// Setup multi-item details
				item.items = objects.map( function( a ) {
					var subItem = {
						id: a.id,
						isMasterObject: a.masterobject && a.masterobject.qInfo.qId,
						details: {
							masterobject: {
								label: translator.get("properties.masterItem"),
								value: a.masterobject && a.masterobject.qMetaDef.title || null
							},
							title: {
								label: translator.get("properties.titleExpression"),
								value: a.properties.title && a.properties.title.qStringExpression ? a.properties.title.qStringExpression.qExpr : a.properties.title
							},
							subtitle: {
								label: translator.get("properties.subtitle"),
								value: a.properties.subtitle && a.properties.subtitle.qStringExpression ? a.properties.subtitle.qStringExpression.qExpr : a.properties.subtitle
							},
							sheet: {
								label: translator.get("Common.Sheet"),
								value: sheetInfo.find( function( b ) {
									return b.id === a.details.sheet;
								}).label
							}
						},
						errors: a.errors,
						preview: {
							url: getSingleVizUrl({
								appId: app.id,
								objId: a.id,
								opts: "nointeraction,noselections"
							})
						},
						code: {
							properties: {
								label: "Properties",
								value: JSON.stringify(a.properties, null, "\t")
							}
						}
					}, data, i;

					// Setup children
					if (a.children && a.children.length) {
						subItem.code.children = {
							label: "Children",
							value: JSON.stringify(a.children, null, "\t")
						};

						data = appInfo.getChildrenDataDefinition(a.children);
					} else if (a.masterobject) {
						data = appInfo.getDataDefinition(a.masterobject);
					} else {
						data = appInfo.getDataDefinition(a.properties);
					}

					// Setup data details (fields, dims, msrs)
					for (i in data) {
						if (data.hasOwnProperty(i)) {
							subItem.details[i] = data[i];

							// Define additional search terms on the parent item
							item.searchTerms += data[i].value.join(" ").concat(" ");
						}
					}

					return prepareItem(subItem);
				});

			// Single item
			} else {
				var data, i;

				// Single item properties
				item.properties = objects[0].properties;
				if (objects[0].children.length) {
					item.children = objects[0].children;
					data = appInfo.getChildrenDataDefinition(objects[0].children);
				} else {
					data = appInfo.getDataDefinition(objects[0].properties);
				}

				// Setup data details (fields, dims, msrs)
				for (i in data) {
					if (data.hasOwnProperty(i)) {
						item.details[i] = data[i];

						// Define additional search terms
						item.searchTerms += data[i].value.join(" ").concat(" ");
					}
				}

				// Define preview
				item.preview = {
					url: getSingleVizUrl({
						appId: app.id,
						objId: item.properties.qInfo.qId,
						opts: "nointeraction,noselections"
					})
				};
			}

			return item;
		}).sort( function( a, b ) {
			return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
		}).map(prepareItem);
	},

	/**
	 * Get the app's dimension information
	 *
	 * @param  {Object} app The app's API
	 * @return {Promise}    List of app dimensions
	 */
	getDimensionInfo = function( app ) {
		return appInfo.dimensions(app.id, { validate: true }).then( function( info ) {
			return info.map( function( a ) {

				// Define additional search terms
				if (a.details && a.details.definition) {
					a.searchTerms = a.details.definition.value.concat(" ");
				}

				return a;
			});
		});
	},

	/**
	 * Get the app's measure information
	 *
	 * @param  {Object} app The app's API
	 * @return {Promise}    List of app measures
	 */
	getMeasureInfo = function( app ) {
		return appInfo.measures(app.id, { validate: true }).then( function( info ) {
			return info.map( function( a ) {

				// Define additional search terms
				if (a.details && a.details.expression) {
					a.searchTerms = a.details.expression.value.concat(" ");
				}

				return a;
			});
		});
	},

	/**
	 * Get the app's visualization (master object) information
	 *
	 * @param  {Object} app The app's API
	 * @return {Promise}    List of app master objects
	 */
	getMasterObjectInfo = function( app ) {
		return appInfo.masterObjects(app.id, { validate: true }).then( function( info ) {
			return info.map( function( a ) {
				var data, i;

				if (a.children && a.children.length) {
					data = appInfo.getChildrenDataDefinition(a.children);
				} else {
					data = appInfo.getDataDefinition(a.properties);
				}

				// Setup string for additional search terms
				a.searchTerms = "";

				for (i in data) {
					if (data.hasOwnProperty(i)) {
						a.details[i] = data[i];

						// Define additional search terms
						a.searchTerms += data[i].value.join(" ").concat(" ");
					}
				}

				// Define preview
				a.preview = {
					url: getSingleVizUrl({
						appId: app.id,
						objId: a.properties.qInfo.qId,
						opts: "nointeraction,noselections"
					})
				};

				return a;
			});
		});
	},

	/**
	 * Get the app's alternate states information
	 *
	 * @param  {Object} app The app's API
	 * @return {Promise}    List of app alternate states
	 */
	getAlternateStateInfo = function( app ) {
		return appInfo.alternateStates(app.id);
	},

	/**
	 * Get the app's variables information
	 *
	 * @param  {Object} app The app's API
	 * @return {Promise}    List of app variables
	 */
	getVariableInfo = function( app ) {
		return appInfo.variables(app.id, { validate: true, qIsReserved: false }).then( function( info ) {
			var infoList = info.map( function( a ) {

				// Define additional search terms
				if (a.details && a.details.definition) {
					a.searchTerms = a.details.definition.value.concat(" ");
				}

				return a;
			});

			// Prepend system variables
			infoList.unshift({
				id: "app.model.layout.qLocaleInfo",
				label: "System variables",
				properties: app.model.layout.qLocaleInfo
			});

			return infoList;
		});
	},

	/**
	 * Get the app's bookmarks information
	 *
	 * @param  {Object} app The app's API
	 * @return {Promise}    List of app bookmarks
	 */
	getBookmarkInfo = function( app ) {
		return appInfo.bookmarks(app.id, { validate: true }).then( function( info ) {
			return info.map( function( a ) {

				// Define additional search terms
				if (a.details && a.details.fields) {
					a.searchTerms = a.details.fields.value.concat(" ");
				}

				return a;
			});
		});
	},

	/**
	 * Get the app's data model
	 *
	 * @param  {Object}  app The app's API
	 * @return {Promise}     App datamodel details
	 */
	getDataModelInfo = function( app ) {
		return app.model.engineApp.getTablesAndKeys({}, {}, 0, true, false).then( function( model ) {
			var profile = {};

			// Bail when profiling is not available
			if ("function" !== typeof app.model.engineApp.getTableProfileData) {
				return {
					profile: null,
					model: model
				};
			}

			/**
			 * EXPERIMENTAL
			 * 2023-02-24
			 *
			 * Query field profiling.
			 */
			model.qtr.forEach( function( qTable ) {
				profile[qTable.qName] = app.model.engineApp.getTableProfileData(qTable.qName);
			});

			return $q.all({
				profile: $q.all(profile),
				model: $q.resolve(model)
			});
		}).then( function( args ) {
			return {
				id: "app.model.engineApp.getTablesAndKeys()",
				label: translator.get("bdi.connect.model"),
				details: {
					tables: {
						label: translator.get("Common.All.Tables"),
						value: args.model.qtr.filter( function( a ) {
							return ! a.qIsSynthetic;
						}).map( function( a ) {
							return a.qName.concat(" (", a.qFields.length, " x ", a.qNoOfRows, ")"); // Cols x Rows
						})
					},
					dataIslands: {
						label: "Data islands",
						value: args.model.qtr.filter( function( a ) {
							return ! a.qFields.filter( function( b ) {
								return "NOT_KEY" !== b.qKeyType;
							}).length;
						}).map( function( a ) {
							return a.qName;
						})
					},
					keys: {
						label: translator.get("DataModelViewer.Footer.Metadata.Keys"),
						value: args.model.qk.map( function( a ) {
							return a.qKeyFields.join(", ");
						})
					},
					syntheticTables: {
						label: "Synthetic tables",
						value: args.model.qtr.filter( function( a ) {
							return a.qIsSynthetic;
						}).map( function( a ) {
							return a.qName.concat(" (", translator.get("Common.Rows"), ": ", a.qNoOfRows, ")");
						})
					},
					syntheticKeys: {
						label: "Synthetic keys",
						value: _.uniq(_.flatten(args.model.qtr.filter( function( a ) {
							return ! a.qIsSynthetic;
						}).map( function( a ) {
							return a.qFields.filter( function( a ) {
								return -1 !== a.qTags.indexOf("$synthetic");
							}).map( function( a ) {
								return a.qName.concat(" [", a.qOriginalFields.join(", "), "]");
							});
						}), 1))
					}
				},
				layout: args.model,
				profile: args.profile,
				code: {
					layout: {
						label: "Datamodel",
						value: JSON.stringify(args.model, null, "\t")
					}
				}
			};
		});
	},

	/**
	 * Get the app's fields information
	 *
	 * @param  {Object} app An app's API
	 * @return {Promise}    List of app fields
	 */
	getFieldInfo = function( app ) {
		return $q.all({
			fields: app.getList("FieldList"),
			datamodel: getDataModelInfo(app)
		}).then( function ( args ) {

			// Remove updates for this session object before going forward
			return args.fields.close().then( function() {
				var fieldInfo = args.fields.layout.qFieldList.qItems.map( function( a ) {
					var item,

					// A field can occur in multiple tables (key fields)
					fieldTables = args.datamodel.layout.qtr.filter( function( b ) {
						return b.qFields.filter( function( c ) {
							return c.qName === a.qName;
						}).length;
					});

					item = {
						id: a.qName,
						label: a.qName,
						count: a.qCardinal,
						icon: -1 !== a.qTags.indexOf("$key") ? "key" : "",
						details: {
							table: {
								label: translator.get("DataModelViewer.searchfield.fieldtype.table"),
								value: fieldTables.map( function( a ) {
									return a.qName;
								})
							},
							tags: {
								label: translator.get("Common.Tags"),
								value: (a.qTags || [])
							}
						}
					};

					// Multi or single item
					if (fieldTables.length > 1) {
						item.items = fieldTables.map( function( b, index ) {
							var item = {
								id: b.qName.concat("/", a.qName),
								properties: b.qFields.find( function( c ) {
									return c.qName === a.qName;
								})
							};

							// Profile is available
							if (args.datamodel.profile) {
								item.code = {
									profile: {
										label: "Profile",
										value: JSON.stringify(args.datamodel.profile[b.qName].qProfiling.qFieldProfiling.find( function( c ) {
											return c.qName === a.qName;
										}), null, "\t")
									}
								};
							}

							return prepareItem(item);
						});
					} else {

						// Profile is available
						if (args.datamodel.profile) {
							item.code = {
								profile: {
									label: "Profile",
									value: JSON.stringify(args.datamodel.profile[fieldTables[0].qName].qProfiling.qFieldProfiling.find( function( c ) {
										return c.qName === a.qName;
									}), null, "\t")
								}
							};
						}

						item.properties = fieldTables[0].qFields.find( function( c ) {
							return c.qName === a.qName;
						});
					}

					return item;
				}).sort( function( a, b ) {
					return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
				});

				// Prepend data model
				fieldInfo.unshift(args.datamodel);

				return fieldInfo;
			});
		});
	},

	/**
	 * Get the app's information
	 *
	 * @param  {Object} app An app's API
	 * @return {Promise}    List of app information
	 */
	getAppInfo = function( app ) {
		return $q.all({
			themeList: qlik.getThemeList(),
			config: app.model.getConfiguration(),
			props: app.model.getProperties(),
			appprops: app.createGenericObject({
				qInfo: {
					qId: "AppPropsList",
					qType: "AppPropsList"
				}
			}).then( function( sessionObject ) {
				return sessionObject.getLayout().then( function( layout ) {
					return app.getObject(layout[0].qInfo.qId).then( function( object ) {
						return object.layout;
					});
				});
			})
		}).then( function( args ) {

			// Load data from QRS
			args.qrsApp = args.config.qFeatures.qIsDesktop
				? $q.resolve({ data: {} })
				: util.qlikRequest("/qrs/app/".concat(app.id)).catch( function() { return { data: {} }; });

			return args;
		}).then( function( args ) {
			var infoList = [{
				id: "app.model.layout",
				label: "Main layout",
				details: {
					title: {
						label: translator.get("Common.Title"),
						value: app.model.layout.qTitle
					},
					description: {
						label: translator.get("Common.Description"),
						value: app.model.layout.description
					},
					filename: {
						label: translator.get("AppDetails.FileName").replace(":", ""), // Strip colon
						value: app.model.layout.qFileName
					},
					stream: {
						label: "Stream", // Translation?
						value: app.model.layout.published ? app.model.layout.stream.name : translator.get("Common.No")
					},
					createdDate: {
						label: "Created", // Translation?
						value: app.model.layout.createdDate ? new Date(app.model.layout.createdDate).toLocaleString() : null // Not available on QS Desktop
					},
					lastLoadedDate: {
						label: translator.get("Toolbar.DataLastLoaded").replace(":", ""), // Strip colon
						value: new Date(app.model.layout.qLastReloadTime).toLocaleString()
					},
					publishedDate: {
						label: translator.get("App.PublishedDate"),
						value: app.model.layout.publishTime ? new Date(app.model.layout.publishTime).toLocaleString() : null // Not available on QS Desktop
					},
					modifiedDate: {
						label: "Modified", // Translation?
						value: app.model.layout.modifiedDate ? new Date(app.model.layout.modifiedDate).toLocaleString() : null // Not available on QS Desktop
					},
					hasdata: {
						label: "Contains data",
						value: app.model.layout.qHasData ? translator.get("Common.Yes") : translator.get("Common.No")
					},
					hassectionaccess: {
						label: "Section Access",
						value: app.model.layout.hassectionaccess ? translator.get("Common.Yes") : translator.get("Common.No")
					}
				},
				layout: app.model.layout
			}, {
				id: "AppPropsList",
				label: translator.get("AppDetails.Options"),
				details: {
					theme: {
						label: translator.get("AppDetails.AppTheme"),
						value: args.themeList.find( function( a ) {
							return a.id === args.appprops.theme;
						}).name
					},
					owner: {
						label: "Owner", // Translation?
						value: "string" === typeof args.appprops.qMeta.owner ? args.appprops.qMeta.owner : (args.appprops.qMeta.owner ? "".concat(args.appprops.qMeta.owner.userDirectory, "/", args.appprops.qMeta.owner.userId) : null)
					}
				},
				layout: args.appprops
			}, {
				id: "app.model.getProperties()",
				label: "Metadata",
				properties: args.props
			}, {
				id: "app.model.getConfiguration()",
				label: "Configuration",
				details: {
					installation: {
						label: "Installation",
						value: util.isQlikCloud
							? "Qlik Cloud"
							: util.isQlikSenseClientManaged
								? "Qlik Sense Client Managed"
								: util.isQlikSenseDesktop
									? "Qlik Sense Desktop"
									: null
					},
					SSOEnabled: {
						label: "SSO",
						value: args.config.qFeatures.qSSOEnabled ? translator.get("Common.Enabled") : translator.get("Common.No")
					}
				},
				layout: args.config
			}];

			// QRS data
			if (! _.isEmpty(args.qrsApp.data)) {
				infoList.push({
					id: "/qrs/app/{id}",
					label: "QRS",
					details: {
						size: {
							label: "File size (MB)", // Translation?
							value: (args.qrsApp.data.fileSize / (1024 * 1024)).toFixed(2)
						}
					},
					layout: args.qrsApp.data
				});
			}

			// Prepend app summary
			infoList.unshift({
				id: app.model.id,
				label: "Summary",
				details: infoList.reduce( function( retval, item ) {
					return _.extend(retval, item.details);
				}, {
					id: app.model.id
				})
			});

			return infoList;
		});
	},

	/**
	 * Get the app's script information
	 *
	 * @param  {Object} app An app's API
	 * @return {Promise}    List of app script sections
	 */
	getScriptInfo = function( app ) {
		return $q.all({
			info: appInfo.script(app.id),
			validation: app.model.enigmaModel.checkScriptSyntax(),
			script: app.getScript()
		}).then( function( args ) {
			var infoList = [];

			// List script sections
			args.info.forEach( function( item ) {
				item.code = item.code || {};

				// Setup code from script
				if (item.hasOwnProperty("script") && ! item.code.hasOwnProperty("script")) {
					item.code.script = {
						label: "Script",
						value: item.script
					};
				}

				// Flag invalid sections
				if (args.validation.length && -1 !== _.pluck(args.validation, "qTabIx").indexOf(item.index)) {
					item.icon = "debug";
					item.errors = item.errors || [];
					args.validation.filter( function( a ) {
						return a.qTabIx === item.index;
					}).forEach( function( a ) {
						item.errors.push({
							message: "Line ".concat(a.qLineInTab),
							errorData: [util.substr_utf8_bytes(args.script.qScript, a.qTextPos, a.qErrLen)]
						});
					});
				}

				infoList.push(item);
			});

			return infoList;
		});
	},

	/**
	 * Define additional parameters on an item
	 *
	 * @param  {Object} item Object item
	 * @return {Object} Item
	 */
	prepareItem = function( item ) {
		var details = [], i, value;

		// Define status parameters
		item.searchTerms = item.searchTerms || "";

		// Add tags to search terms
		if (item.details && item.details.tags) {
			item.searchTerms += item.details.tags.value.join(" ").concat(" ");
		}

		// Transform details to objects of name/label/value
		for (i in item.details || {}) {

			// Only list defined values
			if (item.details.hasOwnProperty(i) && null !== item.details[i] && "undefined" !== typeof item.details[i]) {
				value = (item.details[i].hasOwnProperty && item.details[i].hasOwnProperty("value")) ? item.details[i].value : item.details[i];

				if (false === value || (value && value.length)) {
					details.push({
						name: i,
						label: item.details[i].label || (i[0].toUpperCase() + i.substr(1)),
						value: Array.isArray(value) ? value : [value],
						isCode: !! item.details[i].isCode
					});
				}
			}
		}

		// Overwrite previously defined details to make it an array of labeled values
		item.details = details;

		// Initiate code collection
		if (! item.items) {
			item.code = item.code || {};

			// Setup code from layout
			if ( item.hasOwnProperty("layout") && ! item.code.hasOwnProperty("layout") ) {
				item.code.layout = {
					label: "Layout",
					value: JSON.stringify(item.layout, null, "\t") // use tabs
				};
			}

			// Setup code from properties
			if ( item.hasOwnProperty("properties") && ! item.code.hasOwnProperty("properties") ) {
				item.code.properties = {
					label: "Properties",
					value: JSON.stringify(item.properties, null, "\t") // use tabs
				};
			}

			// Setup code from properties
			if ( item.hasOwnProperty("children") && item.children && ! item.code.hasOwnProperty("children") ) {
				item.code.children = {
					label: "Children",
					value: JSON.stringify(item.children, null, "\t") // use tabs
				};
			}
		}

		return item;
	},

	/**
	 * Holds the global session options
	 *
	 * @type {Object}
	 */
	globalOpts = currApp.global.session.options,

	/**
	 * Holds the app's global baseURI
	 *
	 * Differs from qUtil.baseURI in that it does not assume the 'sense' project
	 * directly following the prefix. This is relevant for setting up `single` urls.
	 *
	 * @return {String}
	 */
	baseURI = (globalOpts.isSecure ? "https://" : "http://").concat(globalOpts.host, ":", globalOpts.port, globalOpts.prefix.replace(/\/+$/g, ""), "/"),

	/**
	 * Return the url for a single sheet
	 *
	 * @param  {Object} options Url options
	 * @return {String} Single sheet url
	 */
	getSingleSheetUrl = function( options ) {
		options = options || {};
		options.opts = options.opts || "nointeraction,noselections";

		return baseURI.concat("single/?appid=", encodeURIComponent(options.appId), "&sheet=", options.sheetId, "&opt=", options.opts);
	},

	/**
	 * Return the url for a single visualization object
	 *
	 * @param  {Object} options Url options
	 * @return {String} Single visualization url
	 */
	getSingleVizUrl = function( options ) {
		options = options || {};
		options.opts = options.opts || "nointeraction,noselections";

		return baseURI.concat("single/?appid=", encodeURIComponent(options.appId), "&obj=", options.objId, "&opt=", options.opts);
	},

	/**
	 * Holds the list of assets in the inspector modal
	 *
	 * @type {Array}
	 */
	assets = [{
		"id": "app",
		"label": translator.get("App") // Translation available?
	}, {
		"id": "errors",
		"label": translator.get("Errors") // Translation available?
	}, {
		"id": "script",
		"label": translator.get("Script") // Translation available?
	}, {
		"id": "field",
		"label": translator.get("Common.Fields")
	}, {
		"id": "sheet",
		"label": translator.get("Common.Sheets")
	}, {
		"id": "chart",
		"label": translator.get("Common.Charts")
	}, {
		"id": "extension",
		"label": translator.get("Common.Extensions")
	}, {
		"id": "dimension",
		"label": translator.get("Common.MasterDimensions")
	}, {
		"id": "measure",
		"label": translator.get("Common.MasterMeasures")
	}, {
		"id": "masterObject",
		"label": translator.get("library.Visualizations")
	}, {
		"id": "alternate-state",
		"label": translator.get("Common.AlternateStates")
	}, {
		"id": "variable",
		"label": translator.get("Common.Variables")
	}, {
		"id": "bookmark",
		"label": translator.get("Common.Bookmarks")
	}],

	/**
	 * Return the asset's label
	 *
	 * @param  {String} id Asset id
	 * @return {String} Asset label
	 */
	getAssetLabel = function( id ) {
		return _.first(_.pluck(_.where(assets, { id: id }), "label"));
	},

	/**
	 * Extension controller function
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} $el Scope's jQuery element
	 * @return {Void}
	 */
	controller = ["$scope", "$element", function( $scope, $el ) {

		/**
		 * Define a two-tiered state-machine for handling events
		 *
		 * @type {StateMachine}
		 */
		var fsm = new util.StateMachine({
			transitions: [{
				from: "IDLE", to: "MODAL", name: "OPEN"
			}, {
				from: "MODAL", to: "IDLE", name: "CLOSE"
			}],
			on: {
				enterModal: function( lifecycle, app ) {
					showAppInspectorForApp(app);
				}
			}
		}),

		/**
		 * Holds the modal for the App Inspector
		 *
		 * @type {Object}
		 */
		modal,

		/**
		 * Open the object app importer modal for the selected app
		 *
		 * @param  {Object} appId Selected app
		 * @return {Void}
		 */
		showAppInspectorForApp = async function( appId ) {
			var app = await openApp(appId);

			// Open the modal
			modal = qvangular.getService("luiDialog").show({
				controller: ["$scope", function( $scope ) {
					var dfd = $q.defer(),

					/**
					 * Return whether the search query matches with the input value
					 *
					 * @param  {String} input Text
					 * @return {Boolean} Search query matches the text
					 */
					matchSearchQuery = function( input ) {
						return (!! input) && -1 !== input.toString().toLowerCase().indexOf( $scope.search.query.toString().toLowerCase() );
					};

					// Setup scope labels and flags
					$scope.okLabel = $scope.input.okLabel || translator.get( "Common.Done" );
					$scope.cancelLabel = $scope.input.cancelLabel || translator.get( "Common.Cancel" );
					$scope.loading = true;

					// Assets and items
					$scope.activeAsset = "app";
					$scope.activeItem = null;
					$scope.activeSubItem = null;
					$scope.activeSubItemIx = 0;
					$scope.assets = assets;
					$scope.allItems = {};
					$scope.filteredItems = {};
					$scope.selected = [];
					$scope.search = {
						query: ""
					};

					/**
					 * Wrapper for an item label
					 *
					 * @param  {Object} item Item data
					 * @return {String} Item label
					 */
					$scope.itemLabel = function( item ) {
						var label = item.label;

						if ("errors" === $scope.activeAsset) {
							label = getAssetLabel(item.asset).concat(" / ", label);
						}

						return label;
					};

					/**
					 * Handle when an asset is clicked
					 *
					 * @param  {String} assetId Asset identifier
					 * @return {Void}
					 */
					$scope.assetClicked = function( assetId ) {

						// Clear active item when changing the asset type
						if ($scope.activeAsset !== assetId) {
							$scope.activeItem = null;
						}

						// Set active asset
						$scope.activeAsset = assetId;

						// Set the selected items
						if ($scope.filteredItems.hasOwnProperty(assetId)) {
							$scope.selected = $scope.filteredItems[assetId];

							// Only update active item when not available in filtered list
							if (null === $scope.activeItem || -1 === $scope.selected.indexOf($scope.activeItem)) {
								$scope.activeItem = $scope.selected[0];
							}

							// Reset subitem
							$scope.subItemClicked(0);
						}
					};

					/**
					 * Handle when a item is clicked
					 *
					 * @param  {Object} item Item data
					 * @return {Void}
					 */
					$scope.itemClicked = function( item ) {

						// Set active item
						$scope.activeItem = item;

						// Reset subitem
						$scope.subItemClicked(0);
					};

					/**
					 * Handle when a subitem is clicked
					 *
					 * @param  {Number} index Subitem index
					 * @return {Void}
					 */
					$scope.subItemClicked = function( index ) {

						// Set active subitem
						if ($scope.activeItem && $scope.activeItem.items) {
							$scope.activeSubItem = $scope.activeItem.items[index];
							$scope.activeSubItemIx = index;
						} else {
							$scope.activeSubItem = null;
							$scope.activeSubItemIx = 0;
						}
					};

					/**
					 * Handle navigating to another item by id
					 *
					 * @param  {String} id Item identifier
					 * @return {Void}
					 */
					$scope.navToItem = function( id ) {
						var item, subItemIx, i, j;

						// Find item in assets
						for (i in $scope.allItems) {

							// Find item in asset list
							for (j = 0; j < $scope.allItems[i].length; j++) {

								// Match id in asset list
								if (id === $scope.allItems[i][j].id) {
									$scope.assetClicked(i);
									$scope.itemClicked($scope.allItems[i][j]);
									return;

								// Find item in item's children
								} else if ($scope.allItems[i][j].children && $scope.allItems[i][j].children.length) {
									for (k = 0; k < $scope.allItems[i][j].children; k++) {

										// Match id in item's children list
										if (id === $scope.allItems[i][j].children[k].id) {
											$scope.assetClicked(i);
											$scope.itemClicked($scope.allItems[i][j]);
											$scope.subItemClicked(subItemIx);
											return;
										}
									}
								}
							}
						}
					};

					/**
					 * Copy value to clipboard
					 *
					 * @param  {String} value Value to copy
					 * @return {Void}
					 */
					$scope.copyToClipboard = function( value ) {
						util.copyToClipboard(value);
					};

					// Get the requested app's objects
					$q.all({
						app: getAppInfo(app),
						script: getScriptInfo(app),
						field: getFieldInfo(app),
						sheet: getSheetInfo(app),
						dimension: getDimensionInfo(app),
						measure: getMeasureInfo(app),
						masterObject: getMasterObjectInfo(app),
						"alternate-state": getAlternateStateInfo(app),
						variable: getVariableInfo(app),
						bookmark: getBookmarkInfo(app)
					}).then( function( args ) {

						// Fetch loaded extension list from app info
						return appInfo.extensions().then( function( extensionList ) {
							args.extensionList = extensionList;
							return args;
						});

					}).then( function( args ) {
						var uniqObjects, i, defaultBookmarkId;

						// Prepare items
						for (i in args) {
							if (Array.isArray(args[i])) {
								$scope.allItems[i] = args[i].map(prepareItem);
							}
						}

						// Setup items derived from others
						uniqObjects               = getUniqueAppObjectsFromSheets(args.sheet, args.extensionList, app);
						$scope.allItems.chart     = uniqObjects.filter( function( a ) { return ! a.isThirdParty; });
						$scope.allItems.extension = uniqObjects.filter( function( a ) { return a.isThirdParty; });

						// Mark the default bookmark found in the AppPropsList
						defaultBookmarkId = $scope.allItems.app.find( function( a ) {
							return a.id === "AppPropsList";
						}).layout.defaultBookmarkId;

						if (!! defaultBookmarkId) {
							for (i = 0; i < $scope.allItems.bookmarks.length; i++) {
								if ($scope.allItems.bookmarks[i].id === defaultBookmarkId) {
									$scope.allItems.bookmarks[i].icon = "bookmark";
									$scope.allItems.bookmarks[i].details.push({
										id: "default",
										label: translator.get("Bookmarks.StartBookmark"),
										value: [translator.get("Bookmarks.StartBookmark.Hint")]
									});
									break;
								}
							}
						}

						// Set default opener
						$scope.selected = $scope.allItems.app;
						$scope.activeItem = $scope.allItems.app.length && $scope.allItems.app[0];

						// Notify loading is done
						$scope.loading = false;

						// Setup watcher for search. This is defined AFTER allItems are retreived, so that
						// the watcher on initial trigger will apply correctly.
						$scope.$watch("search.query", function( query ) {
							var i;

							for (i in $scope.allItems) {
								if ($scope.allItems.hasOwnProperty(i)) {
									$scope.filteredItems[i] = $scope.allItems[i].filter( function( a ) {
										return (! query.length)
											|| matchSearchQuery(a.id) // Search by id
											|| matchSearchQuery(a.label) // Search by label
											|| matchSearchQuery(a.searchTerms); // Search by pre-defined terms
									});
								}
							}

							// Update selected list
							$scope.assetClicked($scope.activeAsset);

							// Update view to reflect search results
							qvangular.$apply($scope);
						});

						// Collect errors
						$scope.allItems.errors = [];
						for (i in $scope.allItems) {
							if ($scope.allItems.hasOwnProperty(i) && "errors" !== i) {
								$scope.allItems[i].forEach( function( a ) {
									if (a.errors && a.errors.length) {
										a.asset = i;
										$scope.allItems.errors.push(a);
									}

									// Add individual errors from sub-items
									if (a.items && a.items.length) {
										a.items.forEach( function( b ) {
											if (b.errors && b.errors.length) {
												b.asset = i;
												b.label = a.label;
												b.icon  = "debug";
												$scope.allItems.errors.push(b);
											}
										})
									}
								});
							}
						}

					}).catch( function( error ) {
						console.error(error);

						qvangular.getService("qvConfirmDialog").show({
							title: "Inspector error",
							message: "Inspect the browser's console for any relevant error data.",
							hideCancelButton: true
						});
					});

					// Provide modal close method to the template
					$scope.close = function() {
						modal.close();
					};
				}],
				template: modalTmpl,
				input: {
					title: "App Inspector for ".concat(app.model.layout.qTitle),
					hideCancelButton: true,
					hideOkButton: false
				},
				variant: false,
				closeOnEscape: true
			});

			// Close the FSM when closing the modal
			modal.closed.then( function() {
				fsm.close();
				modal = null;
			});
		},

		/**
		 * Close the App Inspector modal
		 *
		 * @return {Void}
		 */
		closeAppInspectorForApp = function() {
			if (modal) {
				modal.close();
				modal = null;
			}
		};

		/**
		 * Check whether the user has access to the Edit mode
		 *
		 * @type {Boolean}
		 */
		$scope.canSwitchToEdit = qlik.navigation.isModeAllowed(qlik.navigation.EDIT);

		/**
		 * Switch to the Edit mode
		 *
		 * @return {Void}
		 */
		$scope.switchToEdit = function() {
			if ($scope.canSwitchToEdit) {
				qlik.navigation.setMode(qlik.navigation.EDIT);

				// Open the modal after the mode is fully switched
				qvangular.$rootScope.$$postDigest($scope.open);
			}
		};

		/**
		 * Button select handler
		 *
		 * @return {Void}
		 */
		$scope.open = function() {
			if ($scope.object.inEditState()) {
				fsm.open(currApp.id);
			}
		};

		/**
		 * Return whether the modal is opened/active
		 *
		 * @return {Boolean}
		 */
		$scope.isActive = function() {
			return fsm.$is("MODAL");
		};

		/**
		 * Clean up when the controller is destroyed
		 *
		 * @return {Void}
		 */
		$scope.$on("$destroy", function() {
			closeAppInspectorForApp();
		});
	}];

	return {
		definition: props,
		initialProperties: initProps,
		template: tmpl,
		controller: controller,
		support: {
			snapshot: false,
			export: false,
			exportData: false
		}
	};
});
