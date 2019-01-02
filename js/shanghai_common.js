
var PIECE_WIDTH = 20;
var PIECE_DEPTH = 30;
var PIECE_HEIGHT = 15;

var layoutFromQuery;
var storage;

//牌同士の位置関係を記録するために使う。
var positionsRelation = {};

//牌の位置から絵柄を求めるために使う。
var pieceAtPosition = [];

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var container;
var camera, controls, scene, renderer;
var clearColor = new THREE.Color( 0xf0f0f0 );

var images = {};
var defaultMaterials = [];
var meshes = [];
var texLoader;
var raycaster = new THREE.Raycaster(); // create once
var mouse = new THREE.Vector2(); // create once

//クラスの定義
function PositionsRelation(myX, myY, myZ, opX, opY, opZ) {
    this.isCovered = false;
    this.isLeft = false;
    this.isRight = false;

    if(Math.abs(opY - myY) < PIECE_DEPTH) {
        if(myX <= opX) {
            //Z(Height)方向は、隣り合う段にある場合で、かつ、下になっている牌から
            //上にある牌へは気にするが、上にある牌から下にある牌は気にしない。
            if(opX - myX === PIECE_WIDTH && myZ === opZ) {// && opZ - myZ <= PIECE_HEIGHT) {
                //相手は自分の右に接している
                this.isRight = true;
            } else if(opX - myX < PIECE_WIDTH && opZ - myZ === PIECE_HEIGHT) {
                //相手は自分の上に接している
                this.isCovered = true;
            }
        } else if(opX <= myX) {
            if(myX - opX === PIECE_WIDTH && myZ === opZ) {// && opZ - myZ <= PIECE_HEIGHT) {
                //相手は自分の左に接している
                this.isLeft = true;
            } else if(myX - opX < PIECE_WIDTH && opZ - myZ === PIECE_HEIGHT) {
                //相手は自分の上に接している
                this.isCovered = true;
            }
        }
    }
}

PositionsRelation.prototype.isContact = function() {
    return this.isCovered || this.isLeft || this.isRight;
}

function HistoryInfo(firstMeshId, secondMeshId) {
    this.firstMeshId = firstMeshId;
    this.secondMeshId = secondMeshId;
}

//牌同士が重ならないようにする。牌が半分だけずれている場合もある。
//また、ゲーム的に同じ絵柄の牌が重なっていると牌が取れないので、
//そうならないよう、下側・内側から順にペアで配置していく。
function layoutPieces(isNeedSaveToStorage) {
    //console.log(pieces.length);
    //console.log(positions.length);

    //以下の２つが一致しないとゲームとして成立しない。
    if(pieces.length !== positions.length) return;

    makePositionsRelation();

    if(layoutFromQuery) {
        //query文字列で指定された牌の配置を復元。
        pieceAtPosition = JSON.parse(layoutFromQuery);
        if(pieceAtPosition) {
            clearGameState();
            if(isNeedSaveToStorage) {
                //storageに保存
                saveToStorage(pieceAtPosition);
            }
            console.log("piece layout restored from request uri");
        }
    } else if(storage) {
        //リロード時などに、ゲームの状態をstorageから復元する。
        //storageが非nullでもこれからgetItemしたものがnullのことがある。
        //console.log("storage is available");
        var p2pTmp = storage.getItem(gameStatusKey_layout);
        if(p2pTmp) {
            pieceAtPosition = JSON.parse(p2pTmp);
            if(pieceAtPosition) {
                console.log("piece layout restored");
            }
        } else {
            generatePiecesLayoutFromScratch();
            if(isNeedSaveToStorage) {
                saveToStorage(pieceAtPosition);
            }
        }
    } else {
        generatePiecesLayoutFromScratch();
        if(isNeedSaveToStorage) {
            saveToStorage(pieceAtPosition);
        }
    }

    if(false) {
        for(var i = 0; i < pieces.length; i++) {
//             var positionNo = pieceAtPosition.indexOf(pieceID);
//             var rel = positionsRelation[positionNo];
//             var piece = pieceAtPosition[pieceID];
            dumpRelation(i);
        }
    }
}

function generatePiecesLayoutFromScratch() {
    // 同じ絵柄の牌が重ならなくなるまで、配置し直し続ける。
    //この条件を満たしていても、牌の配置によっては、クリアできない状態になる。
    do {
        pieceAtPosition = genRandomArray();
    } while(isPiecesOverlapped());

    for(var i = 0; i < positions.length; i++) {
        dumpPosRelation(i, true, false);
        var p = positions[i];
        //console.log("x:" + p[0] + " y:" + p[1] + " z:" + p[2]);
    }
}


function findLayoutInQuery() {
    var query = location.search;

    //console.log("a:" + query);
    query = query.slice(1);
    //console.log("b:" + query);

    var params = query.split('&');
    for(var i = 0; params[i]; i++) {
        //console.log(i + ":" + params[i]);
        var decoded = decodeURI(params[i]);
        //console.log("decoded:" + decoded);
        var isLayoutFound = decoded.startsWith('layout=[') && decoded.endsWith(']');
        if(isLayoutFound) {
            //console.log("found layout info");
            var replaced = decoded.replace(/%2C/g, ',');
            //console.log("replaced:" + replaced);
            layoutFromQuery = replaced.slice(7);
            //console.log("jsonStr:" + jsonStr);
//            layoutFromQuery = JSON.parse(jsonStr);
            //console.log(json);
        } else {
            //console.log("not found");
        }
    }
}

//同じ絵柄の牌が重なっていないかチェック。このような状態だとゲームを終わらせることができない。
//TODO 以下のチェックでは不十分（同じ牌が他の牌を挟んで並んでいる場合がチェックできていない)
function isPiecesOverlapped() {
    //console.log("checking if overlapped");
    var result = false;

    for(var i = 0; i < positions.length; i++) {
        var piece = pieceAtPosition[i];
        var upperPositions = positionsRelation[i].upper;
        //console.log("piece name at " + piece + " is " + pieces[piece] + ", upper pieces count:" + upperPositions.length);

        for(var upperPos in upperPositions) {
            var otherPiece = pieceAtPosition[upperPos];
            //console.log("i:" + i + ": " + piece + ":" + pieces[piece] + ", " + otherPiece + ":" + pieces[otherPiece]);
            if(otherPiece && pieces[piece] === pieces[otherPiece]) {
                //console.log("NG! overlapped");
                result = true;
                break;
            }
            //console.log("OK, not overlapped");
        }
        if(result) break;
    }
    //console.log("final overlapped check result:" + result);
    return result;
}

function dumpRelation(pieceID) {
    console.log("rel of " + pieceID);
    var positionNo = pieceAtPosition.indexOf(pieceID);
    dumpPosRelation(positionNo, false, false);
}

function dumpPosRelation(positionNo, isDumpNo, isDumpVisible) {
    if(isDumpNo) {
        console.log("position no:" + positionNo);
    }

    return;

    var rel = positionsRelation[positionNo];
    if(rel) {
        //左右の両方か、上に一つでも妨げになる牌が可視なら、選択できない。
        //以下は牌の位置のindex
        for(u of rel.upper) {
            console.log('* u:' + u);
            if(isDumpVisible) {
                var upperPieceIndex = pieceAtPosition.indexOf(u);
                console.log("** position:" + u + ", pieceID:" + upperPieceIndex + ", visible:"+ (meshes[upperPieceIndex].visible));
            }
        }

        for(l of rel.left) {
            console.log('* l:' + l);
            if(isDumpVisible) {
                var leftPieceIndex = pieceAtPosition.indexOf(l);
                console.log("** position:" + l + ", pieceID:" + leftPieceIndex + ", visible:"+ (meshes[leftPieceIndex].visible));
            }
        }

        for(r of rel.right) {
            console.log('* r:' + r);
            if(isDumpVisible) {
                var rightPieceIndex = pieceAtPosition.indexOf(r);
                console.log("** position:" + r + ", pieceID:" + rightPieceIndex + ", visible:"+ (meshes[rightPieceIndex].visible));
            }
        }
    }
}

//牌どうしが隣接しているか否かの関係を求める。場所についての関係で、そこに置かれる牌には直接は関係ない。
function makePositionsRelation() {
    // 総当たりでチェック。牌の高さ方向の重なり具合を判断する必要があるので、
    //総当たりの対戦表の三角形のどちらか半分だけのチェックでは不十分。
    for(var i = 0; i < positions.length; i++) {
        positionsRelation[i] = {};
        positionsRelation[i]['upper'] = [];
        positionsRelation[i]['left'] = [];
        positionsRelation[i]['right'] = [];

        for(var j = 0; j < positions.length; j++) {
            if(i === j) continue;
            var rel = computeRelation(i, j);
            if(rel.isContact()) {
                //relにupper, left, rightのプロパティを設定する。
                if(rel.isCovered) {
                    positionsRelation[i]['upper'].push(j);
                    //ある牌の上に４個以上の別の牌があるという状況はありえない。
                    if(positionsRelation[i]['upper'].length > 4) {
                        console.log("too many pieces on upper. i:" + i);
                    }
                } else if(rel.isLeft) {
                    positionsRelation[i]['left'].push(j);
                    //ある牌の左右どちらかに3個以上の別の牌があるという状況はありえない。
                    if(positionsRelation[i]['left'].length > 2) {
                        console.log("too many pieces on left side. i:" + i);
                    }
                } else if(rel.isRight) {
                    positionsRelation[i]['right'].push(j);
                    if(positionsRelation[i]['right'].length > 2) {
                        console.log("too many pieces on right side. i:" + i);
                    }
                }
            }
        }
    }
}

function computeRelation(me, opponent) {
//    if(me === 14 && opponent === 85) {
//        console.log("break point");
//    }
    return new PositionsRelation(
        positions[me][0],
        positions[me][1],
        positions[me][2],
        positions[opponent][0],
        positions[opponent][1],
        positions[opponent][2]
    );
}

//0 - 牌の数の乱数を一回づつ含む配列を作る。
function genRandomArray() {
    var result = [];
    do {
        var v = Math.floor( Math.random() * (pieces.length) );
        if(!result.includes(v)) result.push(v);
    } while(result.length < pieces.length);

    return result;
}

//http://www.html5canvastutorials.com/tutorials/html5-canvas-image-loader/ を参考にした。
function loadImages(callback) {
    for (var source in imageSources) {
        images[source] = texLoader.load(imageSources[source]);
    }
    callback();
}

function initGL() {
    // renderer
    renderer = new THREE.WebGLRenderer( { antialias: false } );
    renderer.setClearColor(clearColor);
    renderer.setPixelRatio(window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.domElement.style.position = "static";
    renderer.domElement.style.left = "15px";
    renderer.domElement.style.top = "250px";
    container.append( renderer.domElement );

    camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 1000 );
    camera.position.x = -50;
    camera.position.y = 50;
    camera.position.z = 350;

    //2つ目の引数を指定することにより、このコンポーネント内のイベントだけが対象となる。
    //http://stackoverflow.com/questions/13670886/allow-mouse-control-of-three-js-scene-only-when-mouse-is-over-canvas
    controls = new THREE.TrackballControls( camera, renderer.domElement);

    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 0.2;
    controls.panSpeed = 0.8;

    controls.noZoom = false;
    controls.noPan = false;

    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;

    controls.addEventListener( 'change', render );

    // world
    scene = new THREE.Scene();

    // それぞれの牌の上の面に別のテクスチャを表示する。
    for(var p of pieces) {
        var defaultMaterialsTemp = [
            new THREE.MeshLambertMaterial( { color: 0x707070 }),
            new THREE.MeshLambertMaterial( { color: 0x707070 }),
            new THREE.MeshLambertMaterial( { color: 0x707070 }),
            new THREE.MeshLambertMaterial( { color: 0x707070 }),
            new THREE.MeshLambertMaterial({map:images['piece_' + p]}),
            new THREE.MeshLambertMaterial( { color: 0x707070 })
        ];

        defaultMaterials.push(new THREE.MeshFaceMaterial(defaultMaterialsTemp));
    }

    // 牌を決まった位置にランダムに配置する。
    //pickingの結果、pieceIDが得られるので、牌を消去できるかチェックするときに、この情報を使って、
    //pieceがどこにあるかを調べ、positionRelationから周囲の牌の配置を得る。
    for ( var pieceID = 0; pieceID < pieces.length; pieceID++ ) {
        //各pieceに模様を付ける。
        //BoxGeometryだとGLSLでの描画には使えない。addAtributeがない。代わりにBoxBufferGeometryを使う。
        var geometry = new THREE.BoxBufferGeometry(PIECE_WIDTH, PIECE_DEPTH, PIECE_HEIGHT);
        var mesh = new THREE.Mesh( geometry, defaultMaterials[pieceID]);
        mesh['pieceID'] = pieceID;
        //各pieceの位置を設定
        var pos = positions[pieceAtPosition.indexOf(pieceID)];
        if(false) {
            console.log("pieceId:" + pieceID + ", index:" + pieceAtPosition.indexOf(pieceID) + ", pos:" + pos);
        }

        mesh.position.x = pos[0];
        mesh.position.y = pos[1] + 25;
        mesh.position.z = pos[2];

        meshes.push(mesh);
        scene.add( mesh );
    }

    // lights
    light = new THREE.DirectionalLight( 0x002288 );
    light.position.set( -1, -1, -1 );
    scene.add( light );

    light = new THREE.AmbientLight( 0xffffff);
    scene.add( light );
}

function hilightPiece(pieceID, isTurnOn) {
    var value = isTurnOn ? 0x505050 : 0;
    meshes[pieceID].material.materials[4].emissive.set(value);
}

//牌が端にあって、厚み方向の上や左右が他の牌で囲まれていない場合のみ選択できるようにする。
//牌の長手方向の両端に他の牌があっても取れる、
function isSelectable(pieceID) {
    var result = true;

    var positionNo = pieceAtPosition.indexOf(pieceID);
    var rel = positionsRelation[positionNo];
    if(rel) {
        //左右の両方か、上に一つでも妨げになる牌が可視なら、選択できない。
        //以下は牌の位置のindex
        for(u of rel.upper) {
            //meshesの添え字はpieceNoなので、位置からpieceNoへ変換。後のleft,rightも同様。
            var upperPieceIndex = pieceAtPosition[u];
            if(meshes[upperPieceIndex].visible) {
                result = false;
                break;
            }
        }

        if(result) {
            var coveredL = false;
            var coveredR = false;

            for(l of rel.left) {
                var leftPieceIndex = pieceAtPosition[l];
                if(meshes[leftPieceIndex].visible) {
                    coveredL = true;
                    break;
                }
            }
            for(r of rel.right) {
                var rightPieceIndex = pieceAtPosition[r];
                if(meshes[rightPieceIndex].visible) {
                    coveredR = true;
                    break;
                }
            }

            if(coveredL && coveredR) {
                result = false;
            } else if(coveredL && !coveredR) {
                result = true;
            } else if(!coveredL && coveredR) {
                result = true;
            }
            console.log('coveredL:' + coveredL + ', coveredR:' + coveredR + ', result:' + result);
        }
    }

    return result;
}

function setPairVisibleStatus(pair, isVisible) {
    if(pair) {
        var first = pair['firstMeshId'];
        var second = pair['secondMeshId'];
        meshes[first].visible = isVisible;
        meshes[second].visible = isVisible;

        //TODO 強調表示されていたら解除したい。
        render();
    }
}

function resetView() {
    console.log("reset_view button clicked");
    controls.reset();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

    controls.handleResize();

    render();
}

function animate() {
    requestAnimationFrame( animate );
    controls.update();
    render();
}

function render() {
    renderer.render( scene, camera );
}

//日時（秒単位まで)を文字列化。なお、タイムゾーンは常にUTCになる。
function getCurrentDateString() {
    var dt = new Date();
    var dtEncoded = dt.toISOString();
    return dtEncoded;
//    return dtEncoded.replace(/:/g, '-');
}

function saveToStorage(pieceAtPosition) {
    //storageに保存する。牌の配置を復元するには、これを保存しておいて、読み込めばよい。
    var pieceAtPositionJson = JSON.stringify(pieceAtPosition);
    console.log(pieceAtPositionJson);
    storage.setItem(gameStatusKey_layout, pieceAtPositionJson);
    gameStartTimeString = getCurrentDateString();
    storage.setItem(gameStatusKey_starttime, gameStartTimeString);

    var startingText = "starting:" + gameStartTimeString + ", layout:" + pieceAtPositionJson;
    console.log(startingText);
    sendGameStateToServer(startingText);
}
