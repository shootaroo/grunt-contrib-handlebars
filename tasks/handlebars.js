/*
 * grunt-contrib-handlebars
 * http://gruntjs.com/
 *
 * Copyright (c) 2013 Tim Branyen, contributors
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {
  var _ = grunt.util._;
  var helpers = require('grunt-lib-contrib').init(grunt);

  // content conversion for templates
  var defaultProcessContent = function(content) { return content; };

  // AST processing for templates
  var defaultProcessAST = function(ast) { return ast; };

  // filename conversion for templates
  var defaultProcessName = function(name) { return name; };

  // filename conversion for partials
  var defaultProcessPartialName = function(filePath) {
    var pieces = _.last(filePath.split('/')).split('.');
    var name   = _(pieces).without(_.last(pieces)).join('.'); // strips file extension
    if (name.charAt(0) === '_') {
      name = name.substr(1, name.length); // strips leading _ character
    }
    return name;
  };

  var compile = function compile(filepath, options) {
    var processContent = options.processContent || defaultProcessContent;
    var processAST = options.processAST || defaultProcessAST;
    var src = processContent(grunt.file.read(filepath));
    var Handlebars = require('handlebars');
    var ast, compiled;
    try {
      // parse the handlebars template into it's AST
      ast = processAST(Handlebars.parse(src));
      compiled = Handlebars.precompile(ast, options.compilerOptions || {});

      // if configured to, wrap template in Handlebars.template call
      if (options.wrapped === true) {
        compiled = 'Handlebars.template(' + compiled + ')';
      }

      if (options.amd && options.namespace === false) {
        compiled = 'return ' + compiled;
      }
      return compiled;
    } catch (e) {
      grunt.log.error(e);
      grunt.fail.warn('Handlebars failed to compile ' + filepath + '.');
    }
  };

  grunt.registerMultiTask('handlebars', 'Compile handlebars templates and partials.', function() {
    var options = this.options({
      namespace: 'JST',
      separator: grunt.util.linefeed + grunt.util.linefeed,
      wrapped: true,
      amd: false,
      commonjs: false,
      knownHelpers: [],
      knownHelpersOnly: false
    });
    grunt.verbose.writeflags(options, 'Options');

    var nsInfo;
    if (options.namespace !== false) {
      nsInfo = helpers.getNamespaceDeclaration(options.namespace);
    }

    // assign regex for partials directory detection
    var partialsPathRegex = options.partialsPathRegex || /./;

    // assign regex for partial detection
    var isPartial = options.partialRegex || /^_/;

    // assign transformation functions
    var processName = options.processName || defaultProcessName;
    var processPartialName = options.processPartialName || defaultProcessPartialName;

    this.files.forEach(function(f) {
      var partials = [];
      var templates = [];

      // iterate files, processing partials and templates separately
      var files = f.src.filter(function(filepath) {
        // Warn on and remove invalid source files (if nonull was set).
        if (!grunt.file.exists(filepath)) {
          grunt.log.warn('Source file "' + filepath + '" not found.');
          return false;
        } else {
          return true;
        }
      });
      if (files.length === 1) {
        var filepath = files[0];
        var compiled = compile(filepath, options);
        var filename;
        if (partialsPathRegex.test(filepath) && isPartial.test(_.last(filepath.split('/')))) {
          filename = processPartialName(filepath);
          if (options.partialsUseNamespace === true) {
            partials.push('Handlebars.registerPartial('+JSON.stringify(filename)+', '+nsInfo.namespace+'['+JSON.stringify(filename)+'] = '+compiled+');');
          } else {
            partials.push('Handlebars.registerPartial('+JSON.stringify(filename)+', '+compiled+');');
          }
        } else {
          filename = processName(filepath);
          if (options.namespace !== false) {
            templates.push(nsInfo.namespace+'['+JSON.stringify(filename)+'] = '+compiled+';');
          } else if (options.commonjs === true) {
            templates.push('templates = '+compiled+';');
          } else if (options.node === true) {
            templates.push('module.exports = '+compiled+';');
          } else {
            templates.push(compiled);
          }
        }
      } else {
        files.forEach(function(filepath) {
          var compiled = compile(filepath, options);
          var filename;

          // register partial or add template to namespace
          if (partialsPathRegex.test(filepath) && isPartial.test(_.last(filepath.split('/')))) {
            filename = processPartialName(filepath);
            if (options.partialsUseNamespace === true) {
              partials.push('Handlebars.registerPartial('+JSON.stringify(filename)+', '+nsInfo.namespace+'['+JSON.stringify(filename)+'] = '+compiled+');');
            } else {
              partials.push('Handlebars.registerPartial('+JSON.stringify(filename)+', '+compiled+');');
            }
          } else {
            filename = processName(filepath);
            if (options.namespace !== false) {
              templates.push(nsInfo.namespace+'['+JSON.stringify(filename)+'] = '+compiled+';');
            } else if (options.commonjs === true || options.node === true) {
              templates.push('templates['+JSON.stringify(filename)+'] = '+compiled+';');
            } else {
              templates.push(compiled);
            }
          }
        });
      }

      var output = partials.concat(templates);
      if (output.length < 1) {
        grunt.log.warn('Destination not written because compiled files were empty.');
      } else {
        if (options.namespace !== false) {
          output.unshift(nsInfo.declaration);

          if (options.node) {
            output.unshift('Handlebars = glob.Handlebars || require(\'handlebars\');');
            output.unshift('var glob = (\'undefined\' === typeof window) ? global : window,');

            var nodeExport = 'if (typeof exports === \'object\' && exports) {';
            nodeExport += 'module.exports = ' + nsInfo.namespace + ';}';

            output.push(nodeExport);
          }

        } else {
          if (options.node) {
            if (files.length > 1) {
              output.unshift('var templates = {};');
              output.push('module.exports = templates;');
            }
            output.unshift('var Handlebars = require(\'handlebars\');');
          }
        }

        if (options.amd) {
          // Wrap the file in an AMD define fn.
          output.unshift("define(['handlebars'], function(Handlebars) {");
          if (options.namespace !== false) {
            // Namespace has not been explicitly set to false; the AMD
            // wrapper will return the object containing the template.
            output.push("return "+nsInfo.namespace+";");
          }
          output.push("});");
        }

        if (options.commonjs) {
          if (options.namespace === false) {
            output.unshift('var templates = {};');
            output.push("return templates;");
          } else {
            output.push("return "+nsInfo.namespace+";");
          }
          // Export the templates object for CommonJS environments.
          output.unshift("module.exports = function(Handlebars) {");
          output.push("};");
        }

        grunt.file.write(f.dest, output.join(grunt.util.normalizelf(options.separator)));
        grunt.log.writeln('File "' + f.dest + '" created.');
      }
    });

  });

};
