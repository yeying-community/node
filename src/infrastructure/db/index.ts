import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { DataSourceOptions } from 'typeorm/data-source/DataSourceOptions'

export class DataSourceBuilder {
    private readonly options: DataSourceOptions
    private _entities: any[] = []
    private _migrations: any[] = []
    constructor(options: DataSourceOptions) {
        this.options = options
    }

    entities(value: any[]) {
        this._entities = value
    }

    migrations(value: any[]) {
        this._migrations = value
    }

    build() {
        let options: DataSourceOptions
        switch (this.options.type) {
            case 'mysql':
                options = { ...this.options, port: this.options.port ?? 3306 }
            case 'postgres':
                options = { ...this.options, port: this.options.port ?? 5432 }
            default:
                options = this.options
        }
        return new DataSource({ ...options, entities: this._entities, migrations: this._migrations })
    }
}
