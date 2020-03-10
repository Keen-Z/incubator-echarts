/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import * as zrUtil from 'zrender/src/core/util';
import ChartView from '../../view/Chart';
import SunburstPiece from './SunburstPiece';
import DataDiffer from '../../data/DataDiffer';
import SunburstSeriesModel, { SunburstSeriesNodeOption } from './SunburstSeries';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../ExtensionAPI';
import { TreeNode } from '../../data/Tree';

const ROOT_TO_NODE_ACTION = 'sunburstRootToNode';

interface DrawTreeNode extends TreeNode {
    parentNode: DrawTreeNode
    piece: SunburstPiece
    children: DrawTreeNode[]
}
class SunburstView extends ChartView {

    static readonly type = 'sunburst'
    readonly type = SunburstView.type

    seriesModel: SunburstSeriesModel
    api: ExtensionAPI
    ecModel: GlobalModel

    virtualPiece: SunburstPiece

    private _oldChildren: DrawTreeNode[]

    render(
        seriesModel: SunburstSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        // @ts-ignore
        payload
    ) {
        var self = this;

        this.seriesModel = seriesModel;
        this.api = api;
        this.ecModel = ecModel;

        var data = seriesModel.getData();
        var virtualRoot = data.tree.root as DrawTreeNode;

        var newRoot = seriesModel.getViewRoot() as DrawTreeNode;

        var group = this.group;

        var renderLabelForZeroData = seriesModel.get('renderLabelForZeroData');

        var newChildren: DrawTreeNode[] = [];
        newRoot.eachNode(function (node: DrawTreeNode) {
            newChildren.push(node);
        });
        var oldChildren = this._oldChildren || [];

        dualTravel(newChildren, oldChildren);

        renderRollUp(virtualRoot, newRoot);

        if (payload && payload.highlight && payload.highlight.piece) {
            var highlightPolicy = seriesModel.getShallow('highlightPolicy');
            payload.highlight.piece.onEmphasis(highlightPolicy);
        }
        else if (payload && payload.unhighlight) {
            var piece = this.virtualPiece;
            if (!piece && virtualRoot.children.length) {
                piece = virtualRoot.children[0].piece;
            }
            if (piece) {
                piece.onNormal();
            }
        }

        this._initEvents();

        this._oldChildren = newChildren;

        function dualTravel(newChildren: DrawTreeNode[], oldChildren: DrawTreeNode[]) {
            if (newChildren.length === 0 && oldChildren.length === 0) {
                return;
            }

            new DataDiffer(oldChildren, newChildren, getKey, getKey)
                .add(processNode)
                .update(processNode)
                .remove(zrUtil.curry(processNode, null))
                .execute();

            function getKey(node: DrawTreeNode) {
                return node.getId();
            }

            function processNode(newIdx: number, oldIdx?: number) {
                var newNode = newIdx == null ? null : newChildren[newIdx];
                var oldNode = oldIdx == null ? null : oldChildren[oldIdx];

                doRenderNode(newNode, oldNode);
            }
        }

        function doRenderNode(newNode: DrawTreeNode, oldNode: DrawTreeNode) {
            if (!renderLabelForZeroData && newNode && !newNode.getValue()) {
                // Not render data with value 0
                newNode = null;
            }

            if (newNode !== virtualRoot && oldNode !== virtualRoot) {
                if (oldNode && oldNode.piece) {
                    if (newNode) {
                        // Update
                        oldNode.piece.updateData(
                            false, newNode, 'normal', seriesModel, ecModel);

                        // For tooltip
                        data.setItemGraphicEl(newNode.dataIndex, oldNode.piece);
                    }
                    else {
                        // Remove
                        removeNode(oldNode);
                    }
                }
                else if (newNode) {
                    // Add
                    var piece = new SunburstPiece(
                        newNode,
                        seriesModel,
                        ecModel
                    );
                    group.add(piece);

                    // For tooltip
                    data.setItemGraphicEl(newNode.dataIndex, piece);
                }
            }
        }

        function removeNode(node: DrawTreeNode) {
            if (!node) {
                return;
            }

            if (node.piece) {
                group.remove(node.piece);
                node.piece = null;
            }
        }

        function renderRollUp(virtualRoot: DrawTreeNode, viewRoot: DrawTreeNode) {
            if (viewRoot.depth > 0) {
                // Render
                if (self.virtualPiece) {
                    // Update
                    self.virtualPiece.updateData(
                        false, virtualRoot, 'normal', seriesModel, ecModel);
                }
                else {
                    // Add
                    self.virtualPiece = new SunburstPiece(
                        virtualRoot,
                        seriesModel,
                        ecModel
                    );
                    group.add(self.virtualPiece);
                }

                viewRoot.piece.off('click');
                self.virtualPiece.on('click', function (e) {
                    self._rootToNode(viewRoot.parentNode);
                });
            }
            else if (self.virtualPiece) {
                // Remove
                group.remove(self.virtualPiece);
                self.virtualPiece = null;
            }
        }
    }

    /**
     * @private
     */
    _initEvents() {
        this.group.off('click');
        this.group.on('click', (e) => {
            var targetFound = false;
            var viewRoot = this.seriesModel.getViewRoot();
            viewRoot.eachNode((node: DrawTreeNode) => {
                if (!targetFound
                    && node.piece && node.piece.childAt(0) === e.target
                ) {
                    var nodeClick = node.getModel<SunburstSeriesNodeOption>().get('nodeClick');
                    if (nodeClick === 'rootToNode') {
                        this._rootToNode(node);
                    }
                    else if (nodeClick === 'link') {
                        var itemModel = node.getModel<SunburstSeriesNodeOption>();
                        var link = itemModel.get('link');
                        if (link) {
                            var linkTarget = itemModel.get('target', true)
                                || '_blank';
                            window.open(link, linkTarget);
                        }
                    }
                    targetFound = true;
                }
            });
        });
    }

    /**
     * @private
     */
    _rootToNode(node: DrawTreeNode) {
        if (node !== this.seriesModel.getViewRoot()) {
            this.api.dispatchAction({
                type: ROOT_TO_NODE_ACTION,
                from: this.uid,
                seriesId: this.seriesModel.id,
                targetNode: node
            });
        }
    }

    /**
     * @implement
     */
    containPoint(point: number[], seriesModel: SunburstSeriesModel) {
        var treeRoot = seriesModel.getData();
        var itemLayout = treeRoot.getItemLayout(0);
        if (itemLayout) {
            var dx = point[0] - itemLayout.cx;
            var dy = point[1] - itemLayout.cy;
            var radius = Math.sqrt(dx * dx + dy * dy);
            return radius <= itemLayout.r && radius >= itemLayout.r0;
        }
    }

}


ChartView.registerClass(SunburstView);

export default SunburstView;
