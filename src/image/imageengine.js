/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module image/image/imageengine
 */

import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import buildModelConverter from '@ckeditor/ckeditor5-engine/src/conversion/buildmodelconverter';
import buildViewConverter from '@ckeditor/ckeditor5-engine/src/conversion/buildviewconverter';
import { viewFigureToModel, createImageAttributeConverter, convertHoistableImage, hoistImage } from './converters';
import { toImageWidget } from './utils';
import ModelElement from '@ckeditor/ckeditor5-engine/src/model/element';
import ViewContainerElement from '@ckeditor/ckeditor5-engine/src/view/containerelement';
import ViewEmptyElement from '@ckeditor/ckeditor5-engine/src/view/emptyelement';

/**
 * The image engine plugin.
 * Registers `image` as a block element in document's schema and allows it to have two attributes: `src` and `alt`.
 * Registers converters for editing and data pipelines.
 *
 * @extends module:core/plugin~Plugin
 */
export default class ImageEngine extends Plugin {
	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const doc = editor.document;
		const schema = doc.schema;
		const data = editor.data;
		const editing = editor.editing;
		const t = editor.t;

		// Configure schema.
		schema.registerItem( 'image' );
		schema.requireAttributes( 'image', [ 'src' ] );
		schema.allow( { name: 'image', attributes: [ 'alt', 'src' ], inside: '$root' } );
		schema.objects.add( 'image' );

		// Build converter from model to view for data pipeline.
		buildModelConverter().for( data.modelToView )
			.fromElement( 'image' )
			.toElement( () => createImageViewElement() );

		// Build converter from model to view for editing pipeline.
		buildModelConverter().for( editing.modelToView )
			.fromElement( 'image' )
			.toElement( () => toImageWidget( createImageViewElement(), t( 'image widget' ) ) );

		createImageAttributeConverter( [ editing.modelToView, data.modelToView ], 'src' );
		createImageAttributeConverter( [ editing.modelToView, data.modelToView ], 'alt' );

		// Build converter for view img element to model image element.
		buildViewConverter().for( data.viewToModel )
			.from( { name: 'img', attribute: { src: /./ } } )
			.toElement( ( viewImage ) => new ModelElement( 'image', { src: viewImage.getAttribute( 'src' ) } ) );

		data.viewToModel.on( 'element:img', convertHoistableImage( doc ), { priority: 'low' } );
		data.viewToModel.on( 'element', hoistImage(), { priority: 'low' } );

		// Build converter for alt attribute.
		// Note that by default attribute converters are added with `low` priority.
		// This converter will be thus fired after `convertHoistableImage` converter.
		buildViewConverter().for( data.viewToModel )
			.from( { name: 'img', attribute: { alt: /./ } } )
			.consuming( { attribute: [ 'alt' ] } )
			.toAttribute( ( viewImage ) => ( { key: 'alt', value: viewImage.getAttribute( 'alt' ) } ) );

		// Converter for figure element from view to model.
		data.viewToModel.on( 'element:figure', viewFigureToModel() );
	}
}

// Creates view element representing the image.
//
//		<figure class="image"><img></img></figure>
//
// Note that `alt` and `src` attributes are converted separately, so they're not included.
//
// @private
// @return {module:engine/view/containerelement~ContainerElement}
export function createImageViewElement() {
	return new ViewContainerElement( 'figure', { class: 'image' }, new ViewEmptyElement( 'img' ) );
}
